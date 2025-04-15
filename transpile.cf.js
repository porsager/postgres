import fs from 'fs'
import path from 'path'

const empty = x => fs.readdirSync(x).forEach(f => fs.unlinkSync(path.join(x, f)))
    , ensureEmpty = x => !fs.existsSync(x) ? fs.mkdirSync(x) : empty(x)
    , root = 'cf'
    , src = path.join(root, 'src')

ensureEmpty(src)

fs.readdirSync('src').forEach(name =>
  fs.writeFileSync(
    path.join(src, name),
    transpile(fs.readFileSync(path.join('src', name), 'utf8'), name, 'src')
  )
)

function transpile(x) {
  const timers = x.includes('setImmediate')
    ? 'import { setImmediate, clearImmediate } from \'../polyfills.js\'\n'
    : ''

  const process = x.includes('process.')
    ? 'import { process } from \'../polyfills.js\'\n'
    : ''

  const buffer = x.includes('Buffer')
    ? 'import { Buffer } from \'node:buffer\'\n'
    : ''

  return process + buffer + timers + x
    .replace('import net from \'net\'', 'import { net } from \'../polyfills.js\'')
    .replace('import tls from \'tls\'', 'import { tls } from \'../polyfills.js\'')
    .replace('import crypto from \'crypto\'', 'import { crypto } from \'../polyfills.js\'')
    .replace('import os from \'os\'', 'import { os } from \'../polyfills.js\'')
    .replace('import fs from \'fs\'', 'import { fs } from \'../polyfills.js\'')
    .replace('import { performance } from \'perf_hooks\'', 'import { performance } from \'../polyfills.js\'')
    .replace(/ from '([a-z_]+)'/g, ' from \'node:$1\'')
    .replace(/(\s*max\s*:\s*)10+/, '$13') // https://github.com/porsager/postgres/issues/1023
}
