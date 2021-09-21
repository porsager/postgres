const fs = require('fs')
    , path = require('path')

const empty = x => fs.readdirSync(x).forEach(f => fs.unlinkSync(path.join(x, f)))
    , ensureEmpty = x => !fs.existsSync(x) ? fs.mkdirSync(x) : empty(x)
    , root = 'cjs'
    , lib = path.join(root, 'lib')
    , tests = path.join(root, 'tests')

!fs.existsSync(root) && fs.mkdirSync(root)
ensureEmpty(lib)
ensureEmpty(tests)

fs.readdirSync('lib').forEach(name =>
  fs.writeFileSync(
    path.join(lib, name),
    transpile(fs.readFileSync(path.join('lib', name), 'utf8'))
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
          .replace(/export class ([^ ]+) ([\s\S]+)/, 'class $1 $2;module.exports.$1 = $1')
          .replace(/export default /, 'module.exports = ')
          .replace(/export const ([a-z0-9_$]+)/gi, 'const $1 = module.exports.$1')
          .replace(/export function ([a-z0-9_$]+)/gi, 'module.exports.$1 = function $1')
          .replace(/import {([^{}]*?)} from (['"].*?['"])/gi, 'const {$1} = require($2)')
          .replace(/import (.*?) from (['"].*?['"])/gi, 'const $1 = require($2)')
          .replace(/import (['"].*?['"])/gi, 'require($1)')
}
