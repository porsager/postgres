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

  return timers + x
    .replace('import net from \'net\'', 'import { net } from \'../polyfills.js\'')
    .replace('import tls from \'tls\'', 'import { tls } from \'../polyfills.js\'')
    .replace('import crypto from \'crypto\'', 'import { crypto } from \'../polyfills.js\'')
}
