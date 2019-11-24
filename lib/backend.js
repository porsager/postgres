import { errorFields, errors } from './types.js'

const char = (acc, [k, v]) => (acc[k.charCodeAt(0)] = v, acc)
    , N = '\u0000'

export default Backend

function Backend({
  parsers,
  onauth,
  onready,
  resolve,
  reject,
  transform,
  onnotice,
  onnotify
}) {
  let result = null
  let columns = null
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
    settings  : {},
    pid       : null,
    secret    : null
  }

  return backend

  function ParseComplete() {
    // No handling needed
  }

  function BindComplete() {
    // No handling needed
  }

  function CloseComplete() {
    // No handling needed
  }

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
    backend.query && resolve(backend.query.stream
      ? rows + 1
      : result
    )
    result = null
    columns = null
    rows = 0
  }

  function CopyDone(x) {
    // No handling needed
  }

  function DataRow(x) {
    let index = 7
    let length
    let column

    const row = {}
    for (let i = 0; i < columns.length; i++) {
      column = columns[i]
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
      : result.push(row)
  }

  function CopyData(x) {
    // No handling needed until implemented
  }

  function ErrorResponse(x) {
    reject(errors.generic(error(x)))
  }

  function CopyInResponse() {
    reject(errors.notSupported('CopyInResponse'))
  }

  function CopyOutResponse() {
    reject(errors.notSupported('CopyOutResponse'))
  }

  function EmptyQueryResponse() {
    // No handling needed
  }

  function BackendKeyData(x) {
    state.pid = x.readInt32BE(5)
    state.secret = x.readInt32BE(9)
  }

  function NoticeResponse(x) {
    onnotice
      ? onnotice(error(x))
      : console.log(error(x))
  }

  function NoData(x) {
    // No handling needed
  }

  function Authentication(x) {
    const type = x.readInt32BE(5)
    type !== 0 && onauth(type, x)
  }

  function ParameterStatus(x) {
    const [k, v] = x.utf8Slice(5, x.length - 1).split(N)
    state.settings[k] = v
  }

  function PortalSuspended(x) {
    reject(errors.notSupported('PortalSuspended'))
  }

  function ParameterDescription(x) {
    reject(errors.notSupported('ParameterDescription'))
  }

  function RowDescription(x) {
    const length = x.readInt16BE(5)
    let index = 7
    let start

    columns = Array(length)
    result = []
    rows = 0

    for (let i = 0; i < length; ++i) {
      start = index
      while (x[index++] !== 0);
      columns[i] = {
        n: transform(x.utf8Slice(start, index - 1)),
        p: parsers[x.readInt32BE(index + 6)]
      }
      index += 18
    }
  }

  function FunctionCallResponse(x) {
    reject(errors.notSupported('FunctionCallResponse'))
  }

  function NegotiateProtocolVersion(x) {
    reject(errors.notSupported('NegotiateProtocolVersion'))
  }

  function CopyBothResponse(x) {
    reject(errors.notSupported('CopyBothResponse'))
  }

  function ReadyForQuery(x) {
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
