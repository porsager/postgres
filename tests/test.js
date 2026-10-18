import util from 'util'

let done = 0
let only = false
let ignored = 0
let skipped = 0
let current = null
let promise = Promise.resolve()
const tests = {}
    , filter = (process.argv[2] || '').toLowerCase()

export const nt = () => ignored++
export const ot = (...rest) => (only = true, test(true, ...rest))
export const t = (...rest) => test(false, ...rest)
t.timeout = 5
t.before = null
t.ready = Promise.resolve()

process.on('unhandledRejection', stray)
process.on('uncaughtException', stray)

async function test(o, name, options, fn) {
  typeof options !== 'object' && (fn = options, options = {})
  const at = new Error().stack.split('\n').map(x => x.match('/([^/]+\\.js):([0-9]+):')).find(x => x && x[1] !== 'test.js')
      , line = at ? at[1] + ':' + at[2] : '?'

  await 1

  if (only && !o)
    return

  if (filter && !name.toLowerCase().includes(filter))
    return skipped++

  const x = tests[line + ' ' + name] = { fn, line, name }
  promise = promise.then(async() => {
    current = x
    return Promise.race([
      new Promise((resolve, reject) =>
        x.timer = setTimeout(() => reject('Timed out'), (options.timeout || t.timeout) * 1000)
      ),
      new Promise((resolve, reject) => (
        x.stray = reject,
        Promise.resolve().then(t.before).then(fn).then(resolve, reject)
      ))
    ])
  })
    .then(async result => {
      if (!Array.isArray(result))
        throw new Error('Test should return result array')

      const [expected, got] = await Promise.all(result)
      if (expected !== got)
        throw new Error(util.inspect(expected) + ' != ' + util.inspect(got))

      x.succeeded = true
      process.stdout.write('✅')
    })
    .catch(err => {
      x.failed = true
      x.error = err instanceof Error ? err : new Error(util.inspect(err))
      process.stdout.write('⛔️')
    })
    .then(() => {
      clearTimeout(x.timer)
      current = null
      ++done === Object.keys(tests).length && t.ready.then(() => done === Object.keys(tests).length && exit())
    })
}

function stray(err) {
  current && !current.succeeded && !current.failed
    ? current.stray(err)
    : console.error('\n⚠️', 'Stray error outside a test', '\n', util.inspect(err))
}

function exit() {
  const failures = Object.values(tests).filter(x => !x.succeeded)

  console.log('')
  failures.forEach(x =>
    console.error('⛔️', x.name, 'at', x.line, x.failed ? 'failed' : 'never finished', x.error ? '\n' + util.inspect(x.error) : '')
  )

  only || skipped
    ? console.error('⚠️', 'Not all tests were run')
    : ignored
      ? console.error('⚠️', ignored, 'ignored test' + (ignored === 1 ? '' : 's'))
      : failures.length
        ? console.error('⚠️', failures.length, 'of', done, 'failed')
        : console.log('🎉')

  !process.exitCode && (failures.length || only || ignored) && (process.exitCode = 1)
}
