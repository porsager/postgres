import { errorFields, errors } from './types.js'

const char = (acc, [k, v]) => (acc[k.charCodeAt(0)] = v, acc)
    , N = '\u0000'

export default Backend

function Backend({
  onparse,
  onparameter,
  parsers,
  onauth,
  onready,
  resolve,
  reject,
  transform,
  onnotice,
  onnotify
}) {
  let rows = 0

  const backend = Object.entries({
    1: ParseComplete,
    2: BindComplete,
    3: CloseComplete,
    A: NotificationResponse,
    C: CommandComplete,
    c: CopyDone,
    D: DataRow,
    d: CopyData,
    E: ErrorResponse,
    G: CopyInResponse,
    H: CopyOutResponse,
    I: EmptyQueryResponse,
    K: BackendKeyData,
    N: NoticeResponse,
    n: NoData,
    R: Authentication,
    S: ParameterStatus,
    s: PortalSuspended,
    T: RowDescription,
    t: ParameterDescription,
    V: FunctionCallResponse,
    v: NegotiateProtocolVersion,
    W: CopyBothResponse,
    Z: ReadyForQuery
  }).reduce(char, {})

  const state = backend.state = {
    status    : 'I',
    pid       : null,
    secret    : null
  }

  return backend

  function ParseComplete() {
    onparse()
  }

  function BindComplete() { /* No handling needed */ }
  function CloseComplete() { /* No handling needed */ }

  function NotificationResponse(x) {
    if (!onnotify)
      return

    let index = 9
    while (x[index++] !== 0);
    onnotify(
      x.utf8Slice(9, index - 1),
      x.utf8Slice(index, x.length - 1)
    )
  }

  function CommandComplete(x) {
    if (!backend.query)
      return

    for (let i = x.length - 1; i > 0; i--) {
      if (x[i] === 32 && x[i + 1] < 58 && backend.query.result.count === null)
        backend.query.result.count = +x.utf8Slice(i + 1, x.length - 1) // eslint-disable-line
      if (x[i - 1] >= 65) {
        backend.query.result.command = x.utf8Slice(5, i)
        break
      }
    }

    resolve(backend.query.stream
      ? backend.query.result.count
      : backend.query.result
    )
  }

  function CopyDone() { /* No handling needed */ }

  function DataRow(x) {
    let index = 7
    let length
    let column

    const row = {}
    for (let i = 0; i < backend.query.statement.columns.length; i++) {
      column = backend.query.statement.columns[i]
      length = x.readInt32BE(index)
      index += 4

      row[column.n] = length === -1
        ? null
        : column.p === undefined
          ? x.utf8Slice(index, index += length)
          : column.p.array === true
            ? column.p(x.utf8Slice(index + 1, index += length))
            : column.p(x.utf8Slice(index, index += length))
    }

    backend.query.stream
      ? backend.query.stream(row, rows++)
      : backend.query.result.push(row)
  }

  function CopyData() { /* No handling needed until implemented */ }

  function ErrorResponse(x) {
    reject(errors.generic(error(x)))
  }

  function CopyInResponse() {
    reject(errors.notSupported('CopyInResponse'))
  }

  function CopyOutResponse() {
    reject(errors.notSupported('CopyOutResponse'))
  }

  function EmptyQueryResponse() { /* No handling needed */ }

  function BackendKeyData(x) {
    state.pid = x.readInt32BE(5)
    state.secret = x.readInt32BE(9)
  }

  function NoticeResponse(x) {
    onnotice
      ? onnotice(error(x))
      : console.log(error(x))
  }

  function NoData() { /* No handling needed */ }

  function Authentication(x) {
    const type = x.readInt32BE(5)
    try {
      type !== 0 && onauth(type, x)
    } catch (err) {
      reject(err)
    }
  }

  function ParameterStatus(x) {
    const [k, v] = x.utf8Slice(5, x.length - 1).split(N)
    onparameter(k, v)
  }

  function PortalSuspended() {
    reject(errors.notSupported('PortalSuspended'))
  }

  function ParameterDescription() {
    reject(errors.notSupported('ParameterDescription'))
  }

  function RowDescription(x) {
    rows = 0

    if (backend.query.statement.columns)
      return

    const length = x.readInt16BE(5)
    let index = 7
    let start

    backend.query.statement.columns = Array(length)

    for (let i = 0; i < length; ++i) {
      start = index
      while (x[index++] !== 0);
      backend.query.statement.columns[i] = {
        n: transform(x.utf8Slice(start, index - 1)),
        p: parsers[x.readInt32BE(index + 6)]
      }
      index += 18
    }
  }

  function FunctionCallResponse() {
    reject(errors.notSupported('FunctionCallResponse'))
  }

  function NegotiateProtocolVersion() {
    reject(errors.notSupported('NegotiateProtocolVersion'))
  }

  function CopyBothResponse() {
    reject(errors.notSupported('CopyBothResponse'))
  }

  function ReadyForQuery() {
    onready()
  }
}

function error(x) {
  const error = {}
  let start = 5
  for (let i = 5; i < x.length - 1; i++) {
    if (x[i] === 0) {
      error[errorFields[x[start]]] = x.utf8Slice(start + 1, i)
      start = i + 1
    }
  }
  return error
}
