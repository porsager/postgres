const fs = require('fs')
    , path = require('path')

const empty = x => fs.readdirSync(x).forEach(f => fs.unlinkSync(path.join(x, f)))
    , ensureEmpty = x => !fs.existsSync(x) ? fs.mkdirSync(x) : empty(x)
    , root = 'cjs'
    , src = path.join(root, 'src')
    , tests = path.join(root, 'tests')

!fs.existsSync(root) && fs.mkdirSync(root)
ensureEmpty(src)
ensureEmpty(tests)

fs.readdirSync('src').forEach(name =>
  fs.writeFileSync(
    path.join(src, name),
    transpile(fs.readFileSync(path.join('src', name), 'utf8'))
  )
)

fs.readdirSync('tests').forEach(name =>
  fs.writeFileSync(
    path.join(tests, name),
    name.endsWith('.js')
      ? transpile(fs.readFileSync(path.join('tests', name), 'utf8'))
      : fs.readFileSync(path.join('tests', name), 'utf8')
  )
)

fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'commonjs' }))

function transpile(x) {
  return x.replace(/export default function ([^(]+)/, 'module.exports = $1;function $1')
          .replace(/export class ([a-z0-9_$]+)/gi, 'const $1 = module.exports.$1 = class $1')
          .replace(/export default /, 'module.exports = ')
          .replace(/export {/g, 'module.exports = {')
          .replace(/export const ([a-z0-9_$]+)/gi, 'const $1 = module.exports.$1')
          .replace(/export function ([a-z0-9_$]+)/gi, 'module.exports.$1 = $1;function $1')
          .replace(/import {([^{}]*?)} from (['"].*?['"])/gi, 'const {$1} = require($2)')
          .replace(/import (.*?) from (['"].*?['"])/gi, 'const $1 = require($2)')
          .replace(/import (['"].*?['"])/gi, 'require($1)')
          .replace('new URL(x, import.meta.url)', 'require("path").join(__dirname, x)')
}
