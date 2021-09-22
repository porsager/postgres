import fs from 'fs'
import path from 'path'

const empty = x => fs.readdirSync(x).forEach(f => fs.unlinkSync(path.join(x, f)))
    , ensureEmpty = x => !fs.existsSync(x) ? fs.mkdirSync(x) : empty(x)
    , root = 'deno'
    , lib = path.join(root, 'lib')
    , tests = path.join(root, 'tests')

ensureEmpty(lib)
ensureEmpty(tests)

fs.readdirSync('lib').forEach(name =>
  fs.writeFileSync(
    path.join(lib, name),
    transpile(fs.readFileSync(path.join('lib', name), 'utf8'), name, 'lib')
  )
)

fs.readdirSync('tests').forEach(name =>
  fs.writeFileSync(
    path.join(tests, name),
    name.endsWith('.js')
      ? transpile(fs.readFileSync(path.join('tests', name), 'utf8'), name, 'tests')
      : fs.readFileSync(path.join('tests', name), 'utf8')
  )
)

fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'commonjs' }))

function transpile(x, name, folder) {
  if (name === 'bootstrap.js') {
    x = x.replace(/\nexec\(/g, '\nawait execAsync(')
         .replace('{ spawnSync }', '{ spawn }')
  }

  if (folder === 'tests' && name === 'index.js') {
    x = x.replace(/(t\('connect_timeout works)/, 'no$1')
         .replace(/(t\('Copy from file works)/, 'no$1')
         .replace(/(t\('Copy from abort works)/, 'no$1')
  }

  const buffer = x.includes('Buffer')
    ? 'import { Buffer } from \'https://deno.land/std@0.107.0/node/buffer.ts\'\n'
    : ''

  const process = x.includes('process.')
    ? 'import process from \'https://deno.land/std@0.107.0/node/process.ts\'\n'
    : ''

  const timers = x.includes('setImmediate')
    ? 'import { setImmediate, clearImmediate } from \'../polyfills.js\'\n'
    : ''

  const hmac = x.includes('createHmac')
    ? 'import { HmacSha256 } from \'https://deno.land/std@0.107.0/hash/sha256.ts\'\n'
    : ''

  return hmac + buffer + process + timers + x
    .replace(/\.unref\(\)/g, '')
    .replace(
      'crypto.createHmac(\'sha256\', key).update(x).digest()',
      'Buffer.from(new HmacSha256(key).update(x).digest())'
    )
    .replace(
      'query.writable.push({ chunk, callback })',
      '(query.writable.push({ chunk }), callback())'
    )
    .replace(/.setKeepAlive\([^)]+\)/g, '')
    .replace(/import net from 'net'/, 'import { net } from \'../polyfills.js\'')
    .replace(/import tls from 'tls'/, 'import { tls } from \'../polyfills.js\'')
    .replace(/ from '([a-z_]+)'/g, ' from \'https://deno.land/std@0.107.0/node/$1.ts\'')
}
