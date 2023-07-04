import fs from 'fs'
import path from 'path'

const empty = (x) =>
      fs.readdirSync(x).forEach((f) => fs.unlinkSync(path.join(x, f)))
    , ensureEmpty = (x) => (!fs.existsSync(x) ? fs.mkdirSync(x) : empty(x))
    , root = 'cf'
    , src = path.join(root, 'src')

ensureEmpty(src)

fs.readdirSync('src').forEach((name) =>
  fs.writeFileSync(
    path.join(src, name),
    transpile(fs.readFileSync(path.join('src', name), 'utf8'), name, 'src')
  )
)

function transpile(x) {
  const polyfills = [
    x.includes('setImmediate') ? ['setImmediate', 'clearImmediate'] : undefined,
    x.includes('process') ? ['process'] : undefined,
    x.includes('import net from \'net\'') ? ['net'] : undefined,
    x.includes('import tls from \'tls\'') ? ['tls'] : undefined,
    x.includes('import crypto from \'crypto\'') ? ['crypto'] : undefined,
    x.includes('import os from \'os\'') ? ['os'] : undefined,
    x.includes('import fs from \'fs\'') ? ['fs'] : undefined
  ].filter(Boolean).flat()

  const buffer = x.includes('Buffer')
    ? 'import { Buffer } from \'node:buffer\'\n'
    : ''

  return (
    buffer +
    // bulk add polyfills
    (polyfills.length ? `import { ${polyfills.join(', ')} } from '../polyfills.js'\n` : '') +
    x
      // cleanup polyfills
      .replace('import crypto from \'crypto\'\n', '')
      .replace('import net from \'net\'\n', '')
      .replace('import tls from \'tls\'\n', '')
      .replace('import os from \'os\'\n', '')
      .replace('import fs from \'fs\'\n', '')
      .replace(/ from '([a-z_]+)'/g, ' from \'node:$1\'')
  )
}
