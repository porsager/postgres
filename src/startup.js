import crypto from 'crypto'
import fs from 'fs'
import * as p from './protocol.js'
import { Socket, secured, secureOptions } from './socket.js'
import { Errors } from './errors.js'
import { channels, active, start, finish, userName } from './diagnostics.js'

const noop = () => {}

const R = 82
    , S = 83
    , K = 75
    , E = 69
    , N = 78
    , D = 68
    , Z = 90

export async function open(options, signal = { aborted: false, sockets: new Set() }, first = 0) {
  const hosts = options.path ? [null] : options.host
      , wanted = options.target_session_attrs
      , passes = wanted === 'prefer-standby' ? ['standby', 'any'] : [wanted || 'any']

  let last

  for (const want of passes) {
    for (let n = 0; n < hosts.length; n++) {
      const i = (first + n) % hosts.length
          , host = hosts[i]
          , port = options.port[i] || options.port[0]
          , [failed, error, ready] = await traced(options, host, port, signal).then(x => [false, null, x], x => [true, x])
      if (!failed && fits(want, ready.attributes))
        return (ready.index = i, ready)
      failed || ready.socket.end(p.Terminate())
      last = failed ? error : Errors.connection('CONNECTION_DESTROYED', options, host, port)
      if (signal.aborted)
        throw last
    }
  }

  throw last
}

function traced(options, host, port, signal) {
  if (!active(channels.connect))
    return attempt(options, host, port, signal)

  const context = {
    host: options.path ? null : host,
    port: options.path ? null : port,
    path: options.path || null,
    database: options.database,
    user: userName(options),
    ssl: secured(options),
    sslnegotiation: options.sslnegotiation || 'postgres'
  }
  let promise
  start(channels.connect, context, () => promise = attempt(options, host, port, signal))

  return promise.then(ready => {
    finish(channels.connect, context, null, {
      pid: ready.backend.pid,
      status: ready.status,
      readOnly: ready.attributes.readOnly,
      standby: ready.attributes.standby
    })
    return ready
  }, error => {
    finish(channels.connect, context, error)
    throw error
  })
}

function fits(want, { readOnly, standby }) {
  return want === 'any'
      || (want === 'read-write' && !readOnly)
      || (want === 'read-only' && readOnly)
      || (want === 'primary' && !standby)
      || (want === 'standby' && standby)
}

function attempt(options, host, port, signal) {
  const { setTimeout, clearTimeout } = options.timers
      , fail = code => Errors.connection(code, options, host, port)

  return new Promise((resolve, reject) => {
    const timer = options.connect_timeout && setTimeout(() => done(true, fail('CONNECT_TIMEOUT')), options.connect_timeout * 1000)

    let socket = null
      , raw = null
      , settled = false

    session().then(x => done(false, null, x), e => done(true, e))

    function done(failed, error, ready) {
      if (settled)
        return

      settled = true
      timer && clearTimeout(timer)
      socket && signal.sockets.delete(socket)
      signal.aborted && !failed && (failed = true, error = fail('CONNECTION_DESTROYED'))

      if (failed) {
        socket ? socket.destroy() : raw && raw.destroy()
        return reject(error)
      }

      ready.socket.onclose = () => {}
      resolve(ready)
    }

    async function session() {
      socket = await Socket(options, host, port, x => raw = x)
      if (settled || signal.aborted)
        return (socket.destroy(), done(true, fail('CONNECTION_DESTROYED')))

      signal.sockets.add(socket)
      socket.onclose = error => done(true, signal.aborted ? fail('CONNECTION_DESTROYED') : error && error.code ? error : fail('CONNECTION_CLOSED'))
      socket.keepAlive(options.keep_alive)
      await negotiate(socket, options)
      const user = typeof options.user === 'function' ? await options.user() : options.user
      return startup(user, options.database || user)
    }

    function startup(user, database) {
      return new Promise((resolve, reject) => {
        const stored = () => pgpass(options.passfile, options.path ? 'localhost' : host, port, database, user) || ''
            , auth = Auth({ user, pass: options.pass || stored, binding: options.channel_binding, socket })
            , parameters = {}
            , backend = { pid: null, secret: null }
            , frames = p.Frames(frame, false, error => (reject(error), socket.destroy()))
            , rows = []

        let probing = false
          , status = null
          , authing = Promise.resolve()

        socket.ondata = x => frames.push(x)
        socket.write(p.Startup({ user, database, client_encoding: 'UTF8', ...options.connection }))

        function frame(type, x, start, end) {
          try {
            type === R ? authenticate(Buffer.from(x.subarray(start, end)))
              : type === S ? (([k, v]) => parameters[k] = v)(p.parameterStatus(x, start))
              : type === K ? Object.assign(backend, p.backendKeyData(x, start))
              : type === E ? reject(Errors.postgres(p.error(x, start, end)))
              : type === N ? notice(p.error(x, start, end))
              : type === D ? rows.push(x.toString('utf8', start + 11, start + 11 + x.readInt32BE(start + 7)))
              : type === Z && settled(p.readyForQuery(x, start), Buffer.from(x.subarray(end)))
          } catch (error) {
            reject(error)
          }
        }

        function notice(x) {
          try {
            options.onnotice ? options.onnotice(x) : options.onnotice === false || console.log(x)
          } catch (error) {
            noop(error)
          }
        }

        function authenticate(x) {
          authing = authing.then(() => auth(x)).then(reply => reply && socket.write(reply))
          authing.catch(error => (reject(error), socket.destroy()))
        }

        function settled(x, rest) {
          authing.then(() => ready(x, rest), () => {})
        }

        function ready(x, rest) {
          if (!auth.authenticated)
            return reject(Errors.generic('AUTHENTICATION_INCOMPLETE', 'The server was ready before it accepted the authentication'))

          status = x
          const known = 'in_hot_standby' in parameters && 'default_transaction_read_only' in parameters

          if (options.target_session_attrs && !known && !probing) {
            probing = true
            return socket.write(p.Query('show transaction_read_only; select pg_catalog.pg_is_in_recovery()'))
          }

          frames.pause()
          socket.ondata = () => {}
          socket.pause()
          resolve({
            socket,
            rest,
            backend,
            parameters,
            status,
            attributes: {
              readOnly: (known ? parameters.default_transaction_read_only : rows[0]) === 'on',
              standby: known ? parameters.in_hot_standby === 'on' : rows[1] === 't'
            },
            host,
            port,
            cancel: () => cancel(options, host, port, backend)
          })
        }
      })
    }
  })
}

async function negotiate(socket, options) {
  if (!secured(options) || socket.negotiated)
    return

  const ssl = options.ssl
      , tls = secureOptions(ssl)

  if (options.sslnegotiation === 'direct')
    return socket.upgrade({ ...tls, ALPNProtocols: ['postgresql'] })

  const answer = new Promise(r => socket.ondata = x => r(x[0]))
  socket.write(p.SSLRequest())

  if (await answer === S)
    return socket.upgrade(tls)

  if (ssl !== 'prefer' && ssl !== 'allow')
    throw Errors.generic('SSL_NOT_SUPPORTED', 'The server does not support SSL connections')
}

async function cancel(options, host, port, { pid, secret }) {
  const socket = await Socket(options, host, port)
  try {
    await negotiate(socket, options)
  } catch (error) {
    socket.destroy()
    throw error
  }
  return new Promise(resolve => {
    socket.onclose = () => resolve()
    socket.end(p.Cancel(pid, secret))
  })
}

const salted = new Map()

function Auth({ user, pass, binding = 'prefer', socket }) {
  let nonce
    , signature
    , verified = true
    , bound = false
    , header = 'n,,'

  respond.authenticated = false
  return respond

  async function respond(x) {
    const type = x.readInt32BE(5)
    if ((type === 3 || type === 5) && binding === 'require')
      throw unbound('the server asked for ' + (type === 3 ? 'a cleartext' : 'an MD5') + ' password')

    return type === 0 ? ok()
      : type === 3 ? p.Password(await password())
      : type === 5 ? p.Password('md5' + md5(Buffer.concat([Buffer.from(md5(await password() + user)), x.subarray(9, 13)])))
      : type === 10 ? start(x)
      : type === 11 ? proceed(x, await password())
      : type === 12 ? finish(x)
      : unsupported(type)
  }

  function start(x) {
    const offered = x.toString('utf8', 9).split('\0')
        , certificate = binding !== 'disable' && socket && socket.certificate && socket.certificate()
        , hash = certificate && endpoint(certificate)
        , plus = !!hash && offered.includes('SCRAM-SHA-256-PLUS')

    if (binding === 'require' && !plus)
      throw unbound(offered.includes('SCRAM-SHA-256-PLUS') ? 'the server certificate could not be hashed for it' : 'the server did not offer it')

    if (!plus && !offered.includes('SCRAM-SHA-256'))
      throw Errors.generic('SASL_MECHANISM_NOT_SUPPORTED', 'The server offered no supported SASL mechanism')

    header = plus ? 'p=tls-server-end-point,,' : hash ? 'y,,' : 'n,,'
    bound = plus ? hash : false
    nonce = crypto.randomBytes(18).toString('base64')
    verified = false
    return p.SASL(plus ? 'SCRAM-SHA-256-PLUS' : 'SCRAM-SHA-256', header + 'n=*,r=' + nonce)
  }

  function proceed(x, pass) {
    const res = x.toString('utf8', 9).split(',').reduce((acc, x) => (acc[x[0]] = x.slice(2), acc), {})
        , key = sha256(pass + '\0' + res.s + '\0' + res.i).toString('base64')

    if (!res.r.startsWith(nonce))
      throw Errors.generic('SASL_NONCE_MISMATCH', 'The server nonce does not start with the client nonce')

    if (!salted.has(key)) {
      salted.size >= 64 && salted.delete(salted.keys().next().value)
      salted.set(key, crypto.pbkdf2Sync(pass, Buffer.from(res.s, 'base64'), +res.i, 32, 'sha256'))
    }

    const saltedPassword = salted.get(key)
        , clientKey = hmac(saltedPassword, 'Client Key')
        , channel = (bound ? Buffer.concat([Buffer.from(header), bound]) : Buffer.from(header)).toString('base64')
        , auth = 'n=*,r=' + nonce + ',r=' + res.r + ',s=' + res.s + ',i=' + res.i + ',c=' + channel + ',r=' + res.r

    signature = hmac(hmac(saltedPassword, 'Server Key'), auth).toString('base64')
    return p.SASLResponse('c=' + channel + ',r=' + res.r + ',p=' + xor(clientKey, hmac(sha256(clientKey), auth)).toString('base64'))
  }

  function finish(x) {
    if (!signature || x.toString('utf8', 9).split('\0', 1)[0].slice(2) !== signature)
      throw Errors.generic('SASL_SIGNATURE_MISMATCH', 'The server did not return the correct signature')

    verified = true
    return null
  }

  function ok() {
    if (!verified)
      throw Errors.generic('SASL_SIGNATURE_MISMATCH', 'The server ended SCRAM authentication without proving it knows the password')

    if (binding === 'require' && !bound)
      throw unbound('the server authenticated without it')

    respond.authenticated = true
    return null
  }

  function unsupported(type) {
    throw Errors.generic('AUTH_TYPE_NOT_IMPLEMENTED', 'Authentication type ' + type + ' is not supported')
  }

  function password() {
    return Promise.resolve(typeof pass === 'function' ? pass() : pass)
  }
}

function unbound(reason) {
  return Errors.generic('CHANNEL_BINDING_REQUIRED', 'channel_binding is require, but ' + reason)
}

const signatures = {
  '2a864886f70d010104': 'sha256',
  '2a864886f70d010105': 'sha256',
  '2a864886f70d01010e': 'sha224',
  '2a864886f70d01010b': 'sha256',
  '2a864886f70d01010c': 'sha384',
  '2a864886f70d01010d': 'sha512',
  '2a8648ce3d0401': 'sha256',
  '2a8648ce3d040301': 'sha224',
  '2a8648ce3d040302': 'sha256',
  '2a8648ce3d040303': 'sha384',
  '2a8648ce3d040304': 'sha512',
  '2a8648ce380403': 'sha256',
  '608648016503040302': 'sha256'
}

const digests = {
  '2b0e03021a': 'sha256',
  '608648016503040201': 'sha256',
  '608648016503040202': 'sha384',
  '608648016503040203': 'sha512',
  '608648016503040204': 'sha224'
}

function endpoint(certificate) {
  try {
    const x = Buffer.from(certificate)
        , algorithm = signature(x)
    return algorithm ? crypto.createHash(algorithm).update(x).digest() : null
  } catch (_) {
    return null
  }
}

function signature(x) {
  const certificate = der(x, 0)
      , tbs = der(x, certificate.body)
      , algorithm = der(x, tbs.end)
      , oid = der(x, algorithm.body)
      , name = x[oid.start] === 0x06 && x.toString('hex', oid.body, oid.end)

  if (name !== '2a864886f70d01010a')
    return signatures[name]

  if (oid.end >= algorithm.end)
    return 'sha256'

  const params = der(x, oid.end)
      , first = params.body < params.end && der(x, params.body)

  if (!first || x[first.start] !== 0xa0)
    return 'sha256'

  const hash = der(x, der(x, first.body).body)
  return digests[x.toString('hex', hash.body, hash.end)]
}

function der(x, start) {
  let length = x[start + 1]
    , body = start + 2

  if (length & 0x80) {
    const n = length & 0x7f
    length = 0
    for (let i = 0; i < n; i++)
      length = length * 256 + x[body + i]
    body += n
  }

  if (body + length > x.length)
    throw new Error('Truncated certificate')

  return { start, body, end: body + length }
}

function md5(x) {
  return crypto.createHash('md5').update(x).digest('hex')
}

function hmac(key, x) {
  return crypto.createHmac('sha256', key).update(x).digest()
}

function sha256(x) {
  return crypto.createHash('sha256').update(x).digest()
}

function xor(a, b) {
  const x = Buffer.allocUnsafe(a.length)
  for (let i = 0; i < a.length; i++)
    x[i] = a[i] ^ b[i]
  return x
}

function pgpass(file, host, port, database, user) {
  if (!file)
    return null

  let text
  try {
    const stat = fs.statSync(file)
    if (!stat.isFile() || (process.platform !== 'win32' && (stat.mode & 0o077)))
      return null
    text = fs.readFileSync(file, 'utf8')
  } catch (_) {
    return null
  }
  const wanted = [host, String(port), database, user]
  for (const line of text.split(/\r?\n/)) {
    const fields = line && line[0] !== '#' ? split(line) : []
    if (fields.length === 5 && wanted.every((x, i) => fields[i] === '*' || fields[i] === x))
      return fields[4]
  }
  return null
}

function split(line) {
  const fields = []
  let field = ''
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '\\' && i + 1 < line.length)
      field += line[++i]
    else if (c === ':' && fields.length < 4)
      fields.push(field), field = ''
    else
      field += c
  }
  fields.push(field)
  return fields
}
