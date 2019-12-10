const net = require('net')
const tls = require('tls')
const frontend = require('./frontend.js')
const Backend = require('./backend.js')
const Queue = require('./queue.js')
const { errors } = require('./types.js')

module.exports = Connection

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
  let id = 1
  let ended
  let ready = false
  let statements = {}

  const queries = Queue()
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
    resolve,
    reject,
    onnotify,
    onnotice,
    onready,
    onauth
  })

  return connection

  function onparse() {
    if (backend.query && backend.query.statement.sig)
      statements[backend.query.statement.sig] = backend.query.statement
  }

  function onauth(type, x) {
    socket.write(frontend.auth(type, x, options))
  }

  function resolve(x) {
    backend.query.resolve(x)
    backend.query = null
    timeout && queries.length === 0 && idle()
  }

  function reject(err) {
    backend.query ? backend.query.reject(err) : error(err)
    backend.query = null
    timeout && queries.length === 0 && idle()
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

    const buffer = query.simple
      ? simple(str, query)
      : sig in statements
        ? prepared(statements[sig], args, query)
        : prepare(sig, str, args, query)

    backend.query || !ready
      ? queries.push(query)
      : (backend.query = query)

    ready
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
    query.statement = { name: sig ? 'p' + id++ : '', sig }
    return Buffer.concat([
      frontend.Parse(query.statement.name, str, args),
      frontend.Bind(query.statement.name, args)
    ])
  }

  function idle() {
    clearTimeout(timer)
    timer = setTimeout(socket.end, timeout * 1000)
  }

  function onready() {
    if (!backend.query && queries.length === 0 && ended)
      return ended()

    if (!ready) {
      messages.forEach(socket.write)
      messages = []
      ready = true
    }

    if (!backend.query)
      backend.query = queries.shift()
  }

  function data(x) {
    buffer = buffer.length === 0
      ? x
      : Buffer.concat([buffer, x], buffer.length + x.length)

    while (buffer.length > 4) {
      length = buffer.readInt32BE(1)
      if (length >= buffer.length)
        break

      (backend[buffer[0]] || unknown)(buffer.slice(0, length + 1))
      buffer = buffer.slice(length + 1)
    }
  }

  function close() {
    error(errors.connection('CLOSED', options))
    statements = {}
    ready = false
  }

  function unknown() {
    // console.log('Unknown Message', x[0])
  }
}

function postgresSocket(options, {
  error,
  close,
  ready,
  data
}) {
  let socket
  let closed = true

  return {
    ready: false,
    write: x => socket.write(x),
    destroy: () => {
      socket.destroy()
      return Promise.resolve()
    },
    end: () => {
      return new Promise(r => socket && socket.end(r))
    },
    connect
  }

  function onclose() {
    socket.off('data', data)
    socket.off('error', error)
    socket.off('ready', ready)
    socket.off('secureConnect', ready)
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

    socket.once('ready', () => socket.write(Buffer.from('0000000804d2162f', 'hex')))
    socket.once('error', error)
    socket.once('close', onclose)
    socket.once('data', x => {
      socket.off('error', error)
      socket.off('close', onclose)
      x.toString() === 'S'
        ? attach(tls.connect({ socket, ...options.ssl }))
        : error('Server does not support SSL')
    })
  }

  function attach(x) {
    socket = x
    socket.on('data', data)
    socket.once('error', error)
    socket.once('ready', ready)
    socket.once('secureConnect', ready)
    socket.once('close', onclose)
  }
}
