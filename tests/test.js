/* eslint no-console: 0 */

const util = require('util')

let done = 0
let only = false
let ignored = 0
let promise = Promise.resolve()
const tests = {}

module.exports.not = () => ignored++
module.exports.t = (...rest) => test(false, ...rest)
module.exports.ot = (...rest) => (only = true, test(true, ...rest))

async function test(o, name, fn) {
  const line = new Error().stack.split('\n')[3].split(':')[1]
  await 1

  if (only && !o)
    return

  tests[line] = { fn, line, name }
  promise = promise.then(() => Promise.race([
    new Promise((resolve, reject) => fn.timer = setTimeout(() => reject('Timed out'), 500)),
    fn()
  ]))
    .then((x) => {
      if (!Array.isArray(x))
        throw new Error('Test should return result array')

      const [expected, got] = x
      if (expected !== got)
        throw new Error(expected + ' != ' + util.inspect(got))
      tests[line].succeeded = true
      process.stdout.write('✅')
    })
    .catch(err => {
      tests[line].failed = true
      tests[line].error = err instanceof Error ? err : new Error(util.inspect(err))
    })
    .then(() => {
      ++done === Object.keys(tests).length && exit()
    })
}

process.on('exit', exit)

process.on('SIGINT', exit)

function exit() {
  process.removeAllListeners('exit')
  console.log('')
  let success = true
  Object.values(tests).forEach((x) => {
    if (!x.succeeded) {
      success = false
      x.cleanup
        ? console.error('⛔️', x.name + ' at line', x.line, 'cleanup failed', '\n', util.inspect(x.cleanup))
        : console.error('⛔️', x.name + ' at line', x.line, x.failed
          ? 'failed'
          : 'never finished', '\n', util.inspect(x.error)
        )
    }
  })

  ignored && console.error('⚠️', ignored, 'ignored test' + (ignored === 1 ? '' : 's', '\n'))
  !only && success && !ignored
    ? console.log('All good')
    : process.exit(1) // eslint-disable-line
}
