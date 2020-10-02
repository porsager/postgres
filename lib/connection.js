const net = require('net')
const tls = require('tls')
const frontend = require('./frontend.js')
const Backend = require('./backend.js')
const Queue = require('./queue.js')
const { END } = require('./types.js')
const { errors } = require('./errors.js')

module.exports = Connection

let count = 1

function Connection(options = {}) {
  const {
    onparameter,
    transform,
    idle_timeout,
    connect_timeout,
    onnotify,
    onnotice,
    onclose,
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
  let connect_timer

  const queries = Queue()
      , id = count++
      , uid = Math.random().toString(36).slice(2)
      , connection = { send, end, destroy }

  const socket = postgresSocket(options, {
    ready,
    data,
    error,
    close
  })

  const backend = Backend({
    onparse,
    onparameter,
    onsuspended,
    oncomplete,
    transform,
    parsers,
    onnotify,
    onnotice,
    onready,
    onauth,
    error
  })

  function onsuspended(x) {
    new Promise(r => r(backend.query.cursor(
      backend.query.cursor.rows === 1 ? x[0] : x
    ))).then(x => {
      x === END
        ? socket.write(frontend.Close())
        : socket.write(frontend.Execute(backend.query.cursor.rows))
    }).catch(err => {
      backend.query.reject(err)
      socket.write(frontend.Close())
    })
  }

  function oncomplete() {
    backend.query.cursor && socket.write(frontend.Close())
  }

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

    process.nextTick(() => (ready || !backend.query) && ended())

    return promise
  }

  function destroy() {
    error(errors.connection('CONNECTION_DESTROYED', options))
    socket.destroy()
  }

  function error(err) {
    backend.query && backend.query.reject(err)
    let q
    while ((q = queries.shift()))
      q.reject(err)
  }

  function send(query, { sig, str, args = [] }) {
    try {
      query.str = str
      query.args = args
      query.result = []
      query.result.count = null
      idle_timeout && clearTimeout(timer)

      typeof options.debug === 'function' && options.debug(id, str, args)
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
        : (messages.push(buffer), connect())
    } catch (err) {
      query.reject(err)
      idle()
    }
  }

  function connect() {
    connect_timeout && (
      clearTimeout(connect_timer),
      connect_timer = setTimeout(connectTimedOut, connect_timeout * 1000)
    )
    socket.connect()
  }

  function connectTimedOut() {
    error(errors.connection('CONNECT_TIMEOUT', options))
    socket.destroy()
  }

  function simple(str, query) {
    query.statement = {}
    return frontend.Query(str)
  }

  function prepared(statement, args, query) {
    query.statement = statement
    return bind(query, args)
  }

  function prepare(sig, str, args, query) {
    query.statement = { name: sig ? 'p' + uid + statement_id++ : '', sig }
    return Buffer.concat([
      frontend.Parse(query.statement.name, str, args),
      bind(query, args)
    ])
  }

  function bind(query, args) {
    return query.cursor
      ? frontend.Bind(query.statement.name, args, query.cursor.rows)
      : frontend.Bind(query.statement.name, args)
  }

  function idle() {
    if (idle_timeout && !backend.query && queries.length === 0) {
      clearTimeout(timer)
      timer = setTimeout(socket.end, idle_timeout * 1000)
    }
  }

  function onready(err) {
    clearTimeout(connect_timer)
    if (err) {
      if (backend.query) {
        err.stack += backend.query.origin.replace(/.*\n/, '\n')
        Object.defineProperty(err, 'query', {
          value: backend.query.str,
          enumerable: !!options.debug
        })
        Object.defineProperty(err, 'parameters', {
          value: backend.query.args,
          enumerable: !!options.debug
        })
        backend.query.reject(err)
      } else {
        error(err)
      }
    } else if (backend.query) {
      backend.query.resolve(backend.query.results || backend.query.result)
    }

    backend.query = backend.error = null
    idle()

    if (!open) {
      messages.forEach(socket.write)
      messages = []
      open = true
    }

    backend.query = queries.shift()
    ready = !backend.query
    ready && ended && ended()
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
    clearTimeout(connect_timer)
    error(errors.connection('CONNECTION_CLOSED', options))
    statements = {}
    messages = []
    open = ready = false
    onclose && onclose()
  }

  /* c8 ignore next */
  return connection
}

function postgresSocket(options, {
  error,
  close,
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

  function ready() {
    try {
      socket.write(frontend.connect(options))
    } catch (e) {
      error(e)
      socket.end()
    }
  }

  const x = {
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
      return new Promise(r => socket && !closed ? (socket.once('close', r), socket.end()) : r())
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
