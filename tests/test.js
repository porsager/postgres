import util from 'util'

let only = false
let ignored = 0
let promise = Promise.resolve()
const tests = {}

export const not = () => ignored++
export const t = (...rest) => test(false, ...rest)
export const ot = (...rest) => (only = true, test(true, ...rest))

async function test(o, name, fn, after) {
  const line = new Error().stack.split('\n')[3].split(':')[2]
  await 1

  if (only && !o)
    return

  tests[line] = { fn, line, name }
  promise = promise.then(() => fn())
    .then(([expected, got]) => {
      if (expected !== got)
        throw new Error(util.inspect(got) + ' != ' + expected)
      tests[line].succeeded = true
      process.stdout.write('✅')
    })
    .catch(err => {
      tests[line].failed = true
      tests[line].error = err instanceof Error ? err : new Error(util.inspect(err))
    })
    .then(() => after && after())
    .catch((err) => {
      tests[line].succeeded = false
      tests[line].cleanup = err
    })
}

process.on('exit', exit)

function exit() {
  console.log('')
  let success = true
  Object.values(tests).forEach((x) => {
    if (!x.succeeded) {
      success = false
      x.cleanup
        ? console.error('⛔️', x.name + ' at line', x.line, 'cleanup failed', '\n', util.inspect(x.cleanup))
        : console.error('⛔️', x.name + ' at line', x.line, x.failed ? 'failed' : 'never finished', '\n', util.inspect(x.error))
    }
  })

  ignored && console.error('⚠️', ignored, 'ignored test' + (ignored === 1 ? '' : 's', '\n'))
  !only && success && !ignored
    ? console.log('All good')
    : process.exit(1)
}
