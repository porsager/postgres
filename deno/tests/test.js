import process from 'https://deno.land/std@0.107.0/node/process.ts'
/* eslint no-console: 0 */

import util from 'https://deno.land/std@0.107.0/node/util.ts'

let done = 0
let only = false
let ignored = 0
let promise = Promise.resolve()
const tests = {}

export const not = () => ignored++
export const ot = (...rest) => (only = true, test(true, ...rest))

export const t = (...rest) => test(false, ...rest)
t.timeout = 500

async function test(o, name, options, fn) {
  typeof options !== 'object' && (fn = options, options = {})
  const line = new Error().stack.split('\n')[3].match(':([0-9]+):')[1]
  await 1

  if (only && !o)
    return

  tests[line] = { fn, line, name }
  promise = promise.then(() => Promise.race([
    new Promise((resolve, reject) =>
      fn.timer = setTimeout(() => reject('Timed out'), options.timeout || t.timeout)
    ),
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

function exit() {
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

  only
    ? console.error('⚠️', 'Not all tests were run')
    : ignored
      ? console.error('⚠️', ignored, 'ignored test' + (ignored === 1 ? '' : 's', '\n'))
      : success
        ? console.log('All good')
        : console.error('⚠️', 'Not good')

  !process.exitCode && (!success || only || ignored) && (process.exitCode = 1)
}
