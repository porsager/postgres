const originCache = new Map()
    , originStackCache = new Map()
    , originError = Symbol('OriginError')

export const CLOSE = {}
export class Query extends Promise {
  constructor(strings, args, handler, canceller, options = {}) {
    let resolve
      , reject

    super((a, b) => {
      resolve = a
      reject = b
    })

    this.resolver = resolve
    this.rejecter = reject

    this.statistics = handler.stats || handler.debug ? { started: -1, executed: -1 } : undefined
    this.tagged = Array.isArray(strings.raw)
    this.strings = strings
    this.args = args
    this.handler = handler
    this.canceller = canceller
    this.options = options

    this.state = null
    this.statement = null

    this.active = false
    this.cancelled = null
    this.executed = false
    this.signature = ''

    this[originError] = handler.debug
      ? new Error()
      : this.tagged && cachedError(this.strings)
  }

  resolve(x) {
    this.active = false
    this.statistics && addStats(this, x)
    this.handler.onquery && (this.handler.onquery = this.handler.onquery(x))
    this.resolver(x)
  }

  reject(x) {
    this.active = false
    this.statistics && addStats(this, x)
    this.handler.onquery && (this.handler.onquery = this.handler.onquery(x))
    this.rejecter(x)
  }

  get origin() {
    return (this.handler.debug
      ? this[originError].stack
      : this.tagged && originStackCache.has(this.strings)
        ? originStackCache.get(this.strings)
        : originStackCache.set(this.strings, this[originError].stack).get(this.strings)
    ) || ''
  }

  static get [Symbol.species]() {
    return Promise
  }

  cancel() {
    return this.canceller && (this.canceller(this), this.canceller = null)
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
            this.resolve = () => (this.active = false, resolve({ done: true }))
            this.reject = x => (this.active = false, reject(x))
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

  stats() {
    this.statistics = { started: -1, executed: -1 }
    return this
  }

  values() {
    this.isRaw = 'values'
    return this
  }

  async handle() {
    if (this.executed)
      return

    this.executed = true
    await 1
    this.statistics && (this.statistics.started = performance.now())
    this.handler.onquery && (this.handler.onquery = this.handler.onquery(this))
    this.handler(this)
  }

  execute() {
    this.handle()
    return this
  }

  then() {
    this.handle()
    return super.then.apply(this, arguments)
  }

  catch() {
    this.handle()
    return super.catch.apply(this, arguments)
  }

  finally() {
    this.handle()
    return super.finally.apply(this, arguments)
  }
}

function cachedError(xs) {
  if (originCache.has(xs))
    return originCache.get(xs)

  const x = Error.stackTraceLimit
  Error.stackTraceLimit = 4
  originCache.set(xs, new Error())
  Error.stackTraceLimit = x
  return originCache.get(xs)
}


function addStats(query, result) {
  result.waiting = query.statistics.executed - query.statistics.started
  result.duration = performance.now() - query.statistics.started
  result.execution = performance.now() - query.statistics.executed
}
