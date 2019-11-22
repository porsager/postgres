import net from 'net'
import tls from 'tls'
import frontend from './frontend.js'
import Backend from './backend.js'
import Queue from './queue.js'
import { errors } from './types.js'

export default function Connection(options = {}) {
  const {
    database,
    user,
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

  const queries = Queue()
      , statements = new Map()
      , connection = { send, end, ready: false, active: false }

  const socket = postgresSocket(options, {
    data,
    ready,
    error,
    close
  })

  const backend = Backend({
    parsers,
    resolve,
    reject,
    onnotify,
    onnotice,
    onready,
    onauth
  })

  return connection

  function onauth(type, x) {
    socket.write(frontend.auth(type, x, options))
  }

  function resolve(x) {
    backend.query.resolve(x)
    backend.query = null
    timeout && connection.active && queries.length === 0 && idle()
  }

  function reject(err) {
    backend.query ? backend.query.reject(err) : error(err)
    backend.query = null
    timeout && connection.active && queries.length === 0 && idle()
  }

  function end() {
    return new Promise((resolve) => {
      ended = function() {
        socket.end()
        resolve()
      }
    })
  }

  function destroy() {
    error(errors.connection('DESTROYED'))
    socket.destroy()
  }

  function error(err) {
    let q
    while ((q = queries.shift()))
      q.reject(err)
  }

  function send(query, { str, args = [] }) {
    timeout && clearTimeout(timer)
    !connection.ready || backend.query
      ? queries.push(query)
      : (backend.query = query)

    const buffer = statements.has(str)
      ? prepared(statements.get(str), str, args)
      : prepare(str, args)

    connection.ready
      ? socket.write(buffer)
      : (messages.push(buffer), socket.connect())
  }

  function prepared(name, str, args) {
    return frontend.Bind(name, args)
  }

  function prepare(str, args) {
    const name = 'p' + id++
    statements.set(str, name)
    return Buffer.concat([
      frontend.Parse(name, str, args),
      frontend.Bind(name, args)
    ])
  }

  function idle() {
    clearTimeout(timer)
    timer = setTimeout(socket.end, timeout * 1000)
  }

  function onready() {
    if (!backend.query)
      backend.query = queries.shift()

    if (!backend.query && queries.length === 0 && ended)
      return ended()

    if (!connection.ready) {
      messages.forEach(socket.write)
      messages = []
      connection.ready = true
    }
  }

  function data(x) {
    buffer = buffer.length === 0
      ? x
      : Buffer.concat([buffer, x], buffer.length + x.length)

    while (buffer.length > 4) {
      length = buffer.readInt32BE(1)
      if (length >= buffer.length)
        break

      (backend[buffer[0]] || unknown)(buffer)
      buffer = buffer.slice(length + 1)
    }
  }

  function ready() {
    socket.write(frontend.connect({ user, database }))
  }

  function close() {
    error(errors.connection('CLOSED', options))
    statements.clear()
    connection.ready = connection.active = false
  }

  function unknown(buffer) {
    // console.log('Unknown Message', buffer[0])
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
  let ended = false

  return {
    ready: false,
    write: x => socket.write(x),
    end: () => {
      ended = true
      socket.end()
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
