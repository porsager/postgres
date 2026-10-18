import util from 'util'
import { build, isQuery, Join, joinStrings } from './build.js'
import { ours } from './errors.js'
import { channels, active, start, finish, now, userName } from './diagnostics.js'
import { statement } from './result.js'

const origins = new WeakMap()

export const CLOSE = {}

export class Query extends Promise {
  constructor(strings, args, handler, options = {}) {
    let resolve
      , reject

    super((a, b) => {
      resolve = a
      reject = b
    })

    this.fulfil = resolve
    this.fail = reject

    this[isQuery] = true
    this.tagged = Array.isArray(strings.raw)
    this.strings = strings
    this.args = args
    this.handler = handler
    this.options = options

    this.state = null
    this.source = null
    this.active = false
    this.executed = false
    this.settled = false
    this.built = null
    this.trace = null
    this.aborts = null

    this.originError = handler.debug ? new Error() : null
    this.tagged && !handler.debug && !origins.has(strings) && origins.set(strings, located())
  }

  static get [Symbol.species]() {
    return Promise
  }

  join(items) {
    const kept = [...items].filter(x => x !== false && x !== null && x !== undefined)
        , joined = new Query(joinStrings, [new Join(this, kept)], this.handler)

    Object.defineProperty(joined, 'length', { value: kept.length })
    return joined
  }

  resolve(x) {
    this.aborts && this.aborts()
    this.active = false
    this.settled = true
    this.trace && traced(this, null, x)
    this.fulfil(x)
  }

  reject(x) {
    this.aborts && this.aborts()
    this.active = false
    this.settled = true
    this.trace && traced(this, x)
    this.fail(x)
  }

  get origin() {
    return this.originError
      ? this.originError.stack
      : this.tagged && origins.get(this.strings) || ''
  }

  get statement() {
    return this.source && statement(this.source)
  }

  build() {
    return this.built || (this.built = build(this, this.handler.options))
  }

  get text() {
    return this.build().text
  }

  get parameters() {
    return this.build().values
  }

  [util.inspect.custom](depth, options, inspect) {
    if (!this.handler.debug)
      return 'Query {}'

    let x
    try {
      x = this.build()
    } catch (error) {
      return 'Query { ' + error.message + ' }'
    }
    return 'Query ' + inspect({ text: x.text, parameters: x.values }, options)
  }

  cancel() {
    return this.handler.cancel ? this.handler.cancel(this) : Promise.resolve()
  }

  signal(signal) {
    if (!signal || this.settled)
      return this

    if (signal.aborted)
      return (this.cancel(), this)

    const abort = () => this.cancel()
    signal.addEventListener('abort', abort, { once: true })
    this.aborts = () => (this.aborts = null, signal.removeEventListener('abort', abort))
    return this
  }

  simple() {
    this.options.simple = true
    this.options.prepare = false
    return this
  }

  async readable() {
    this.simple()
    this.streaming = true
    return this
  }

  async writable() {
    this.simple()
    this.streaming = true
    return this
  }

  cursor(rows = 1, fn) {
    this.options.simple = false
    if (typeof rows === 'function') {
      fn = rows
      rows = 1
    }

    this.cursorRows = rows

    if (typeof fn === 'function')
      return (this.cursorFn = fn, this)

    let prev
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          if (this.executed && !this.active)
            return { done: true }

          prev && prev()
          const promise = new Promise((resolve, reject) => {
            this.cursorFn = value => {
              resolve({ value, done: false })
              return new Promise(r => prev = r)
            }
            this.resolve = x => (this.active = false, this.settled = true, this.trace && traced(this, null, x), resolve({ done: true }))
            this.reject = x => (this.active = false, this.settled = true, this.trace && traced(this, x), reject(x))
          })
          this.execute()
          return promise
        },
        return() {
          prev && prev(CLOSE)
          return { done: true }
        }
      })
    }
  }

  describe() {
    this.options.simple = false
    this.onlyDescribe = this.options.prepare = true
    return this
  }

  stream() {
    throw new Error('.stream has been renamed to .forEach')
  }

  forEach(fn) {
    this.forEachFn = fn
    this.handle()
    return this
  }

  raw() {
    this.isRaw = true
    return this
  }

  values() {
    this.isRaw = 'values'
    return this
  }

  handle() {
    if (this.executed)
      return

    this.executed = true
    queueMicrotask(() => this.run())
  }

  run() {
    active(channels.query)
      ? start(channels.query, this.trace = context(this), () => this.handler(this))
      : this.handler(this)
  }

  execute() {
    this.handle()
    return this
  }

  then(fulfilled, rejected) {
    this.handle()
    return super.then(fulfilled, rejected)
  }

  catch(rejected) {
    this.handle()
    return super.catch(rejected)
  }

  finally(fn) {
    this.handle()
    return super.finally(fn)
  }
}

function context(q) {
  const options = q.handler.options || {}
  let text = null
  if (q.strings.length) {
    try {
      text = q.text
    } catch (error) {
      text = null
    }
  }
  return {
    query: text,
    parameters: undefined,
    database: options.database,
    user: userName(options),
    host: null,
    port: null,
    connection: null,
    statement: null,
    command: null,
    count: null,
    queued: now(),
    sent: null,
    firstByte: null,
    complete: null
  }
}

function traced(q, error, result) {
  const x = q.trace
  q.trace = null
  x.complete = now()
  if (result && typeof result === 'object' && 'command' in result) {
    x.command = result.command
    x.count = result.count
  }
  finish(channels.query, x, error, result)
}

function located() {
  const limit = Error.stackTraceLimit
  Error.stackTraceLimit = 8
  try {
    return trim(String(new Error().stack))
  } catch (error) {
    return ''
  } finally {
    Error.stackTraceLimit = limit
  }
}

function trim(stack) {
  const lines = stack.split('\n')
      , i = lines.findIndex((x, i) => i > 0 && !ours(x))

  return i === -1 ? stack : lines.slice(0, i + 1).join('\n')
}
