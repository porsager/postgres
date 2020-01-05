const { errorFields, errors, entries } = require('./types.js')

const char = (acc, [k, v]) => (acc[k.charCodeAt(0)] = v, acc)
    , N = '\u0000'

module.exports = Backend

function Backend({
  onparse,
  onparameter,
  parsers,
  onauth,
  onready,
  transform,
  onnotice,
  onnotify,
  error
}) {
  let rows = 0

  const backend = entries({
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

  function ParseComplete() {
    onparse()
  }

  /* c8 ignore next 2 */
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
        backend.query.result.count = +x.utf8Slice(i + 1, x.length - 1)
      if (x[i - 1] >= 65) {
        backend.query.result.command = x.utf8Slice(5, i)
        break
      }
    }
  }

  /* c8 ignore next 3 */
  function CopyDone() { /* No handling needed */ }

  function DataRow(x) {
    let index = 7
    let length
    let column
    let value

    const row = {}
    for (let i = 0; i < backend.query.statement.columns.length; i++) {
      column = backend.query.statement.columns[i]
      length = x.readInt32BE(index)
      index += 4

      value = length === -1
        ? null
        : column.p === undefined
          ? x.utf8Slice(index, index += length)
          : column.p.array === true
            ? column.p(x.utf8Slice(index + 1, index += length))
            : column.p(x.utf8Slice(index, index += length))

      row[column.n] = transform.value ? transform.value(value) : value
    }

    backend.query.stream
      ? backend.query.stream(transform.row ? transform.row(row) : row, rows++)
      : (backend.query.result[rows++] = transform.row ? transform.row(row) : row)
  }

  /* c8 ignore next 3 */
  function CopyData() { /* No handling needed until implemented */ }

  function ErrorResponse(x) {
    backend.query
      ? (backend.error = errors.generic(parseError(x)))
      : error(errors.generic(parseError(x)))
  }

  /* c8 ignore next 3 */
  function CopyInResponse() {
    backend.error = errors.notSupported('CopyInResponse')
  }

  /* c8 ignore next 3 */
  function CopyOutResponse() {
    backend.error = errors.notSupported('CopyOutResponse')
  }

  /* c8 ignore next 3 */
  function EmptyQueryResponse() { /* No handling needed */ }

  function BackendKeyData(x) {
    state.pid = x.readInt32BE(5)
    state.secret = x.readInt32BE(9)
  }

  function NoticeResponse(x) {
    onnotice
      ? onnotice(parseError(x))
      : console.log(parseError(x)) // eslint-disable-line
  }

  function NoData() { /* No handling needed */ }

  function Authentication(x) {
    const type = x.readInt32BE(5)
    type !== 0 && onauth(type, x, error)
  }

  function ParameterStatus(x) {
    const [k, v] = x.utf8Slice(5, x.length - 1).split(N)
    onparameter(k, v)
  }

  /* c8 ignore next 3 */
  function PortalSuspended() {
    backend.error = errors.notSupported('PortalSuspended')
  }

  /* c8 ignore next 3 */
  function ParameterDescription() {
    backend.error = errors.notSupported('ParameterDescription')
  }

  function RowDescription(x) {
    if (backend.query.result.command) {
      backend.query.results = backend.query.results || [backend.query.result]
      backend.query.results.push(backend.query.result = [])
      backend.query.result.count = null
      backend.query.statement.columns = null
    }

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
        n: transform.column
          ? transform.column(x.utf8Slice(start, index - 1))
          : x.utf8Slice(start, index - 1),
        p: parsers[x.readInt32BE(index + 6)]
      }
      index += 18
    }
  }

  /* c8 ignore next 3 */
  function FunctionCallResponse() {
    backend.error = errors.notSupported('FunctionCallResponse')
  }

  /* c8 ignore next 3 */
  function NegotiateProtocolVersion() {
    backend.error = errors.notSupported('NegotiateProtocolVersion')
  }

  /* c8 ignore next 3 */
  function CopyBothResponse() {
    backend.error = errors.notSupported('CopyBothResponse')
  }

  function ReadyForQuery() {
    onready(backend.error)
  }

  return backend
}

function parseError(x) {
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
