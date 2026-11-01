import net from 'net'
import tls from 'tls'

const noop = () => {}
    , agent = globalThis.navigator && globalThis.navigator.userAgent || ''
    , workers = agent.startsWith('Cloudflare-Workers')
    , onreadSafe = !agent || agent.startsWith('Node.js') || agent.startsWith('Bun') || agent.startsWith('Deno')
    , node = !agent || agent.startsWith('Node.js')
    , contexts = new WeakMap()

export async function Socket(options, host, port, track = noop) {
  const raw = options.socket
    ? await options.socket(options, host, port)
    : await connect(options, host, port, track)

  return wrap(raw, host)
}

export function secureOptions(ssl) {
  return ssl === 'require' || ssl === 'allow' || ssl === 'prefer'
    ? workers ? {} : { rejectUnauthorized: false }
    : typeof ssl === 'object' ? context(ssl) : {}
}

function context(ssl) {
  if (!node || ssl.secureContext || !ssl.ca)
    return ssl

  const values = { ...ssl }
  let last = contexts.get(ssl)
  last && same(values, last.values) || contexts.set(ssl, last = { values, secureContext: tls.createSecureContext(values) })
  return { ...values, secureContext: last.secureContext }
}

function same(a, b) {
  return [...Object.keys(a), ...Object.keys(b)].every(k => a[k] === b[k])
}

export const secured = options => !!options.ssl && options.ssl !== 'disable'

export const direct = options => secured(options) && options.sslnegotiation === 'direct'

function connect(options, host, port, track) {
  return new Promise((resolve, reject) => {
    const tlsNow = direct(options)
        , plain = !secured(options)
        , reads = (plain || tlsNow) && onreadSafe && options.onread !== false && {
          buffer: Buffer.allocUnsafe(65536),
          callback: (n, b) => socket.ondata(b.subarray(0, n))
        }
        , target = options.path ? { path: options.path } : { port, host }
        , socket = tlsNow
          ? tls.connect({
            ...target,
            servername: net.isIP(host || '') || options.path ? undefined : host,
            ...secureOptions(options.ssl),
            ALPNProtocols: ['postgresql'],
            ...(reads ? { onread: reads } : {})
          })
          : net.connect({ ...target, ...(reads ? { onread: reads } : {}) })
    track(socket)
    socket.shared = !!reads
    socket.secure = tlsNow
    socket.ondata = noop
    socket.once('error', reject)
    socket.once(tlsNow ? 'secureConnect' : 'connect', () => {
      socket.off('error', reject)
      socket.setNoDelay(true)
      resolve(socket)
    })
  })
}

function wrap(socket, host) {
  let closed = false
    , failure = null

  socket.shared && (socket.ondata = data)

  const x = {
    ondata: noop,
    ondrain: noop,
    onclose: noop,
    get raw() { return socket },
    get closed() { return closed },
    get shared() { return !!socket.shared },
    get negotiated() { return !!socket.secure || !!socket.negotiated },
    certificate() {
      const x = typeof socket.getPeerCertificate === 'function' && socket.getPeerCertificate()
      return x && x.raw || null
    },
    write: data => !closed && socket.write(data),
    upgrade,
    pause: () => socket.pause(),
    resume: () => socket.resume(),
    ref: () => socket.ref && socket.ref(),
    unref: () => socket.unref && socket.unref(),
    end(data) {
      closed || (data ? socket.end(data) : socket.end())
    },
    destroy(error) {
      error && !failure && (failure = error)
      socket.destroy()
    },
    keepAlive(seconds) {
      seconds && socket.setKeepAlive && socket.setKeepAlive(true, 1000 * seconds)
    }
  }

  listen()
  return x

  function listen() {
    socket.on('data', data)
    socket.on('drain', drain)
    socket.on('error', error)
    socket.on('close', close)
  }

  function unlisten() {
    socket.off('data', data)
    socket.off('drain', drain)
    socket.off('error', error)
    socket.off('close', close)
  }

  function data(buffer) { x.ondata(buffer) }
  function drain() { x.ondrain() }
  function error(err) {
    failure || (failure = err)
    socket.destroy()
    close()
  }

  function close() {
    if (closed)
      return

    closed = true
    x.onclose(failure)
  }

  function upgrade(options = {}) {
    return new Promise((resolve, reject) => {
      unlisten()
      const secure = tls.connect({
        socket,
        servername: net.isIP(host || '') ? undefined : host,
        ...options
      })
      const fail = err => {
        secure.off('secureConnect', ready)
        reject(err)
      }
      function ready() {
        secure.off('error', fail)
        socket = secure
        listen()
        resolve(x)
      }
      secure.once('secureConnect', ready)
      secure.once('error', fail)
    })
  }
}
