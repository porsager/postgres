const crypto = require('crypto')
const bytes = require('./bytes.js')
const { errors, entries } = require('./types.js')

const N = String.fromCharCode(0)
const execute = bytes
  .inc(5)
  .str('D').i32(6).str('P').str(N)
  .str('E').i32(9).z(5)
  .str('H').i32(4)
  .str('S').i32(4)
  .end().slice(5)

const authNames = {
  2 : 'KerberosV5',
  3 : 'CleartextPassword',
  5 : 'MD5Password',
  6 : 'SCMCredential',
  7 : 'GSS',
  8 : 'GSSContinue',
  9 : 'SSPI',
  10: 'SASL',
  11: 'SASLContinue',
  12: 'SASLFinal'
}

const auths = {
  3 : AuthenticationCleartextPassword,
  5 : AuthenticationMD5Password,
  10: SASL,
  11: SASLContinue,
  12: SASLFinal
}


module.exports = {
  connect,
  auth,
  Bind,
  Parse,
  Query
}

function connect({ user, database, connection }) {
  return bytes
    .inc(4)
    .i16(3)
    .z(2)
    .str(entries(Object.assign({
      user,
      database,
      client_encoding: '\'utf-8\''
    },
      connection
    )).filter(([, v]) => v).map(([k, v]) => k + N + v).join(N))
    .z(2)
    .end(0)
}

function auth(type, x, options, pass) {
  if (type in auths)
    return auths[type](type, x, options, pass)
  /* c8 ignore next */
  throw errors.generic({
    message: 'Auth type ' + (authNames[type] || type) + ' not implemented',
    type: authNames[type] || type,
    code: 'AUTH_TYPE_NOT_IMPLEMENTED'
  })
}

function AuthenticationCleartextPassword(type, x, options, pass) {
  return bytes
    .p()
    .str(pass)
    .z(1)
    .end()
}

function AuthenticationMD5Password(type, x, options, pass) {
  return bytes
    .p()
    .str('md5' + md5(Buffer.concat([Buffer.from(md5(pass + options.user)), x.slice(9)])))
    .z(1)
    .end()
}

function SASL(type, x, options) {
  bytes
    .p()
    .str('SCRAM-SHA-256' + N)

  const i = bytes.i

  options.nonce = crypto.randomBytes(18).toString('base64')

  return bytes
    .inc(4)
    .str('n,,n=*,r=' + options.nonce)
    .i32(bytes.i - i - 4, i)
    .end()
}

function SASLContinue(type, x, options, pass) {
  const res = x.utf8Slice(9).split(',').reduce((acc, x) => (acc[x[0]] = x.slice(2), acc), {})

  const saltedPassword = crypto.pbkdf2Sync(
    pass,
    Buffer.from(res.s, 'base64'),
    parseInt(res.i), 32,
    'sha256'
  )

  const clientKey = hmac(saltedPassword, 'Client Key')

  const auth = 'n=*,r=' + options.nonce + ','
             + 'r=' + res.r + ',s=' + res.s + ',i=' + res.i
             + ',c=biws,r=' + res.r

  options.serverSignature = hmac(hmac(saltedPassword, 'Server Key'), auth).toString('base64')

  return bytes.p()
    .str('c=biws,r=' + res.r + ',p=' + xor(clientKey, hmac(sha256(clientKey), auth)).toString('base64'))
    .end()
}

function SASLFinal(type, x, options) {
  if (x.utf8Slice(9).split(N, 1)[0].slice(2) === options.serverSignature)
    return ''
  /* c8 ignore next 4 */
  throw errors.generic({
    message: 'The server did not return the correct signature',
    code: 'SASL_SIGNATURE_MISMATCH'
  })
}

function Query(x) {
  return bytes
    .Q()
    .str(x + N)
    .end()
}

function Bind(name, args) {
  let prev

  bytes
    .B()
    .str(N)
    .str(name + N)
    .i16(0)
    .i16(args.length)

  args.forEach(x => {
    if (x.value == null)
      return bytes.i32(0xFFFFFFFF)

    prev = bytes.i
    bytes
      .inc(4)
      .str(x.value)
      .i32(bytes.i - prev - 4, prev)
  })

  bytes.i16(0)

  return Buffer.concat([
    bytes.end(),
    execute
  ])
}

function Parse(name, str, args) {
  bytes
    .P()
    .str(name + N)
    .str(str + N)
    .i16(args.length)

  args.forEach(x => bytes.i32(x.type))

  return bytes.end()
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
  const length = Math.max(a.length, b.length)
  const buffer = Buffer.allocUnsafe(length)
  for (let i = 0; i < length; i++)
    buffer[i] = a[i] ^ b[i]
  return buffer
}
