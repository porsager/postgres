import { EventEmitter } from 'node:events'
import { Buffer } from 'node:buffer'

const Crypto = globalThis.crypto

let ids = 1
const tasks = new Set()

const v4Seg = '(?:[0-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5])'
const v4Str = `(${v4Seg}[.]){3}${v4Seg}`
const IPv4Reg = new RegExp(`^${v4Str}$`)

const v6Seg = '(?:[0-9a-fA-F]{1,4})'
const IPv6Reg = new RegExp(
  '^(' +
  `(?:${v6Seg}:){7}(?:${v6Seg}|:)|` +
  `(?:${v6Seg}:){6}(?:${v4Str}|:${v6Seg}|:)|` +
  `(?:${v6Seg}:){5}(?::${v4Str}|(:${v6Seg}){1,2}|:)|` +
  `(?:${v6Seg}:){4}(?:(:${v6Seg}){0,1}:${v4Str}|(:${v6Seg}){1,3}|:)|` +
  `(?:${v6Seg}:){3}(?:(:${v6Seg}){0,2}:${v4Str}|(:${v6Seg}){1,4}|:)|` +
  `(?:${v6Seg}:){2}(?:(:${v6Seg}){0,3}:${v4Str}|(:${v6Seg}){1,5}|:)|` +
  `(?:${v6Seg}:){1}(?:(:${v6Seg}){0,4}:${v4Str}|(:${v6Seg}){1,6}|:)|` +
  `(?::((?::${v6Seg}){0,5}:${v4Str}|(?::${v6Seg}){1,7}|:))` +
  ')(%[0-9a-zA-Z-.:]{1,})?$'
)

const textEncoder = new TextEncoder()
export const crypto = {
  randomBytes: l => Crypto.getRandomValues(Buffer.alloc(l)),
  pbkdf2Sync: async(password, salt, iterations, keylen) =>
    Crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt,
        iterations
      },
      await Crypto.subtle.importKey(
        'raw',
        textEncoder.encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
      ),
      keylen * 8,
      ['deriveBits']
    ),
  createHash: type => ({
    update: x => ({
      digest: encoding => {
        if (!(x instanceof Uint8Array)) {
          x = textEncoder.encode(x)
        }
        let prom
        if (type === 'sha256') {
          prom = Crypto.subtle.digest('SHA-256', x)
        } else if (type === 'md5') {
          prom = Crypto.subtle.digest('md5', x)
        } else {
          throw Error('createHash only supports sha256 or md5 in this environment, not ${type}.')
        }
        if (encoding === 'hex') {
          return prom.then((arrayBuf) => Buffer.from(arrayBuf).toString('hex'))
        } else if (encoding) {
          throw Error(`createHash only supports hex encoding or unencoded in this environment, not ${encoding}`)
        } else {
          return prom
        }
      }
    })
  }),
  createHmac: (type, key) => ({
    update: x => ({
      digest: async() =>
        Buffer.from(
          await Crypto.subtle.sign(
            'HMAC',
            await Crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
            textEncoder.encode(x)
          )
        )
    })
  })
}

export const performance = globalThis.performance

export const process = {
  env: {}
}

export const os = {
  userInfo() {
    return { username: 'postgres' }
  }
}

export const fs = {
  readFile() {
    throw new Error('Reading files not supported on CloudFlare')
  }
}

export const net = {
  isIP: (x) => IPv4Reg.test(x) ? 4 : IPv6Reg.test(x) ? 6 : 0,
  Socket
}

export { setImmediate, clearImmediate }

