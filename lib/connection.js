const net = require('net')
const tls = require('tls')
const frontend = require('./frontend.js')
const Backend = require('./backend.js')
const Queue = require('./queue.js')
const { errors } = require('./types.js')

module.exports = Connection

let count = 1

function Connection(options = {}) {
  const {
    onparameter,
    transform,
    timeout,
    onnotify,
    onnotice,
    parsers
  } = options
  let buffer = Buffer.alloc(0)
  let length = 0
  let messages = []
  let timer
  let statement_id = 1
  let ended
  let open = false
  let ready = false
  let statements = {}

  const queries = Queue()
      , id = count++
      , connection = { send, end, destroy }

  const socket = postgresSocket(options, {
    ready: () => socket.write(frontend.connect(options)),
    data,
    error,
    close
  })

  const backend = Backend({
    onparse,
    onparameter,
    transform,
    parsers,
    onnotify,
    onnotice,
    onready,
    onauth,
    error
  })

  function onparse() {
    if (backend.query && backend.query.statement.sig)
      statements[backend.query.statement.sig] = backend.query.statement
  }

  function onauth(type, x, onerror) {
    Promise.resolve(
      typeof options.pass === 'function'
        ? options.pass()
        : options.pass
    ).then(pass =>
      socket.write(frontend.auth(type, x, options, pass))
    ).catch(onerror)
  }

  function end() {
    clearTimeout(timer)
    const promise = new Promise((resolve) => {
      ended = () => resolve(socket.end())
    })

    if (!backend.query && queries.length === 0)
      ended()

    return promise
  }

  function destroy() {
    error(errors.connection('DESTROYED', options))
    socket.destroy()
  }

  function error(err) {
    let q
    while ((q = queries.shift()))
      q.reject(err)
  }

  function send(query, { sig, str, args = [] }) {
    query.result = []
    query.result.count = null
    timeout && clearTimeout(timer)

    options.debug && options.debug(id, str, args)
    const buffer = query.simple
      ? simple(str, query)
      : sig in statements
        ? prepared(statements[sig], args, query)
        : prepare(sig, str, args, query)

    ready
      ? (backend.query = query, ready = false)
      : queries.push(query)

    open
      ? socket.write(buffer)
      : (messages.push(buffer), socket.connect())
  }

  function simple(str, query) {
    query.statement = {}
    return frontend.Query(str)
  }

  function prepared(statement, args, query) {
    query.statement = statement
    return frontend.Bind(statement.name, args)
  }

  function prepare(sig, str, args, query) {
    query.statement = { name: sig ? 'p' + statement_id++ : '', sig }
    return Buffer.concat([
      frontend.Parse(query.statement.name, str, args),
      frontend.Bind(query.statement.name, args)
    ])
  }

  function idle() {
    clearTimeout(timer)
    timer = setTimeout(socket.end, timeout * 1000)
  }

  function onready(err) {
    err
      ? (backend.query ? backend.query.reject(err) : error(err))
      : (backend.query && backend.query.resolve(backend.query.results || backend.query.result))

    backend.query = backend.error = null
    timeout && queries.length === 0 && idle()

    if (queries.length === 0 && ended)
      return ended()

    if (!open) {
      messages.forEach(socket.write)
      messages = []
      open = true
    }

    backend.query = queries.shift()
    ready = !backend.query
  }

  function data(x) {
    buffer = buffer.length === 0
      ? x
      : Buffer.concat([buffer, x], buffer.length + x.length)

    while (buffer.length > 4) {
      length = buffer.readInt32BE(1)
      if (length >= buffer.length)
        break

      backend[buffer[0]](buffer.slice(0, length + 1))
      buffer = buffer.slice(length + 1)
    }
  }

  function close() {
    error(errors.connection('CLOSED', options))
    statements = {}
    open = ready = false
  }

  /* c8 ignore next */
  return connection
}

function postgresSocket(options, {
  error,
  close,
  ready,
  data
}) {
  let socket
  let closed = true
  let next = null
  let buffer

  function onclose() {
    socket.removeListener('data', data)
    socket.removeListener('error', error)
    socket.removeListener('connect', ready)
    socket.removeListener('secureConnect', ready)
    closed = true
    close()
  }

  function connect() {
    if (!closed)
      return

    closed = false

    const socket = options.path
      ? net.connect(options.path)
      : net.connect(options.port, options.host)

    if (!options.ssl)
      return attach(socket)

    socket.once('connect', () => socket.write(Buffer.from('0000000804d2162f', 'hex')))
    socket.once('error', error)
    socket.once('close', onclose)
    socket.once('data', x => {
      socket.removeListener('error', error)
      socket.removeListener('close', onclose)
      x.toString() === 'S'
        ? attach(tls.connect(Object.assign({ socket }, options.ssl)))
        : /* c8 ignore next */ error('Server does not support SSL')
    })
  }

  function attach(x) {
    socket = x
    socket.on('data', data)
    socket.once('error', error)
    socket.once('connect', ready)
    socket.once('secureConnect', ready)
    socket.once('close', onclose)
  }

  const x = {
    ready: false,
    write: x => {
      buffer = buffer ? Buffer.concat([buffer, x]) : Buffer.from(x)
      if (buffer.length >= 1024)
        return write()
      next === null && (next = setImmediate(write))
    },
    destroy: () => {
      socket && socket.destroy()
      return Promise.resolve()
    },
    end: () => {
      return new Promise(r => socket && socket.end(r))
    },
    connect
  }

  function write() {
    socket.write(buffer)
    next !== null && clearImmediate(next)
    buffer = next = null
  }

  /* c8 ignore next */
  return x
}
