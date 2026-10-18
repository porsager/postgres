import { connect } from 'cloudflare:sockets'
import { EventEmitter } from 'node:events'
import { Buffer } from 'node:buffer'
import postgres, { PostgresError } from './index.js'
import { Errors } from './errors.js'
import { secured, direct } from './socket.js'

export default function Postgres(a, b) {
  return typeof a === 'string' || !a
    ? postgres(a, { socket, ...b })
    : postgres({ socket, ...a })
}

Object.assign(Postgres, postgres)

export { PostgresError }

export async function socket(options, host, port) {
  if (direct(options))
    throw Errors.generic('SSL_NEGOTIATION_NOT_SUPPORTED', 'sslnegotiation: direct needs ALPN, which Cloudflare Workers sockets do not offer')

  const tls = secured(options)
  let raw = connect({ hostname: host, port }, { secureTransport: tls ? 'starttls' : 'off', allowHalfOpen: false })
  await raw.opened

  let secure = false
  if (tls) {
    const writer = raw.writable.getWriter()
        , reader = raw.readable.getReader()
    await writer.write(sslRequest)
    const { value, done } = await reader.read()
    writer.releaseLock()
    reader.releaseLock()

    if (done)
      throw Errors.connection('CONNECTION_CLOSED', options, host, port)

    if (value[0] === 83) {
      raw = raw.startTls()
      await raw.opened
      secure = true
    } else if (options.ssl !== 'prefer' && options.ssl !== 'allow') {
      raw.close()
      throw Errors.generic('SSL_NOT_SUPPORTED', 'The server does not support SSL connections')
    }
  }

  return Stream(raw, secure, host, port)
}

const sslRequest = Buffer.from([0, 0, 0, 8, 4, 210, 22, 47])
    , chunk = 16384

function Stream(raw, secure, host, port) {
  const x = new EventEmitter()
      , writer = raw.writable.getWriter()
      , reader = raw.readable.getReader()

  let paused = false
    , wake = null
    , closed = false
    , pending = 0
    , answered = !secure

  const written = () => --pending === 0 && x.emit('drain')

  Object.assign(x, {
    secure,
    negotiated: true,
    destroyed: false,
    write(data) {
      if (closed)
        return false

      for (let i = 0; i < data.length; i += chunk) {
        pending++
        writer.write(data.subarray(i, i + chunk)).then(written, fail)
      }
      return pending < 16
    },
    end(data) {
      data && x.write(data)
      writer.close().catch(() => {})
    },
    destroy() {
      x.destroyed = true
      raw.close().catch(() => {})
      finish()
    },
    pause() {
      paused = true
    },
    resume() {
      paused = false
      wake && (wake(), wake = null)
    },
    setKeepAlive() {},
    setNoDelay() {}
  })

  read()
  return x

  function resumed() {
    return new Promise(r => wake = r)
  }

  async function read() {
    try {
      while (true) {
        paused && await resumed()
        const { value, done } = await reader.read()

        if (done)
          break

        answered = true
        x.emit('data', Buffer.from(value.buffer, value.byteOffset, value.byteLength))
      }
    } catch (error) {
      closed || x.emit('error', handshake(error))
    }
    finish()
  }

  function fail(error) {
    closed || x.emit('error', handshake(error))
    x.destroy()
  }

  function finish() {
    if (closed)
      return

    answered || x.destroyed || x.emit('error', handshake())
    closed = true
    x.emit('close')
  }

  function handshake(error) {
    if (answered)
      return error

    answered = true

    return Object.assign(Errors.generic('TLS_HANDSHAKE_FAILED',
      'The TLS connection to ' + host + ':' + port + ' was lost before the server answered. '
      + 'Workers could not complete the TLS handshake, most often because the server certificate is not trusted by a public CA'
    ), { cause: error })
  }
}
