import { spawn } from 'child_process'
import fs from 'fs'

const mode = process.argv[2]
    , port = process.env.POOLER_PORT || '6432'
    , expected = JSON.parse(fs.readFileSync(new URL('pooler.json', import.meta.url), 'utf8'))
    , allowed = new Set([...expected.always, ...expected.flaky, ...(expected[mode] || [])])

if (!expected[mode])
  throw new Error('usage: node tests/pooler.js <' + Object.keys(expected).filter(x => x !== 'always' && x !== 'flaky').join('|') + '>')

const child = spawn(process.execPath, [new URL('index.js', import.meta.url).pathname], {
  env: { ...process.env, POOLER_PORT: port, ...(mode === 'transaction' ? { PREPARE: 'false' } : {}) },
  stdio: ['ignore', 'pipe', 'pipe']
})

let output = ''
child.stdout.on('data', x => (output += x, process.stdout.write(x)))
child.stderr.on('data', x => output += x)

const done = setInterval(() => /\d+ of \d+ failed|🎉/.test(output.slice(-3000)) && setTimeout(finish, 2000), 1000)
child.on('close', finish)

let finished = false
function finish() {
  if (finished)
    return

  finished = true
  clearInterval(done)
  child.kill()
  const failed = [...output.matchAll(/⛔️ (.+?) at ([a-z]+\.js):\d+ failed/g)].map(x => x[2] + ': ' + x[1])
      , unexpected = failed.filter(x => !allowed.has(x))
      , fixed = [...allowed].filter(x => !failed.includes(x) && (expected[mode] || []).includes(x))
  console.log('\n' + failed.length + ' failed through the pooler in ' + mode + ' mode, ' + (failed.length - unexpected.length) + ' of them expected')
  fixed.length && console.log('Expected to fail but passed, so no longer needs to be listed:\n  ' + fixed.join('\n  '))
  unexpected.length && console.log('⚠️ Unexpected failures:\n  ' + unexpected.join('\n  '))
  process.exitCode = unexpected.length ? 1 : 0
}
