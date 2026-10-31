import { open as startup } from './startup.js'
import { Connection, slow, notable } from './connection.js'
import { Query } from './query.js'
import { Errors, PostgresError, queryError } from './errors.js'
import { channels, listened } from './diagnostics.js'

const begins = /\bbegin\b/i
    , starts = /\bstart\b/gi
    , transaction = /^transaction\b/i

export function Pool(options, types) {
  const { setTimeout, clearTimeout, now } = options.timers
      , statements = Statements(options.scheduler)
      , connections = new Set()
      , waiting = Queue()
      , events = {
        parser: types.parser,
        decoder: types.decoder,
        serializer: types.serializer,
        onready,
        onclose,
        onnotify: options.onnotify,
        onparameter,
        ontimed
      }
      , work = { fast: 0, slow: 0, at: 0 }

  const signal = { aborted: false, sockets: new Set() }
      , replacing = []

  let opening = 0
    , ending = null
    , used = false
    , endTimer = null
    , retries = 0
    , failingSince = null
    , nextAttempt = 0
    , retryTimer = null
    , typesLoaded = options.fetch_types === false
    , typesError = null
    , typesFailed = 0
    , failure = null
    , typesLoading = false

  const pool = {
    query,
    lease,
    cancel,
    end,
    close,
    get stats() {
      return {
        connections: connections.size,
        opening,
        idle: [...connections].filter(x => x.inflight === 0 && !x.lease).length,
        leased: [...connections].filter(x => x.lease).length,
        waiting: waiting.length
      }
    }
  }

  return pool

  function query(q, lease) {
    if (ending && !lease)
      return q.reject(queryError(Errors.connection('CONNECTION_ENDED', options, options.host[0], options.port[0]), q, options.debug))

    let built
    try {
      built = q.build()
    } catch (error) {
      return unbuilt(q, error, lease)
    }

    const free = !lease && options.max !== 1

    if (q.options.simple && !built.values.length) {
      const known = (free || options.scheduler) && statements.known(built.text)
      q.alone = free && alone(known)
      options.scheduler && (q.cost = known)
      return place({ q, simple: built.text, exclusive: !!q.streaming || q.alone }, lease)
    }

    if (q.onlyDescribe)
      return describeOnly(q, built, lease)

    const statement = statements.get(built, options.prepare && q.options.prepare !== false)
    q.alone = free && alone(statement.live ? statement : statements.known(built.text))
    q.wire = { statement, built }
    options.scheduler && (q.cost = statement.cost)
    place({ q, statement, exclusive: !!q.cursorFn || !!q.streaming || q.alone }, lease)
  }

  function describeOnly(q, built, lease) {
    const statement = { name: '', text: built.text, oids: built.oids, columns: null }
        , run = c => (q.connection = c, c.describe(statement, built.oids).then(
          ({ params, columns }) => q.resolve({ string: built.text, types: params, name: '', columns }),
          error => q.reject(queryError(error, q, options.debug))
        ), q.onwrite && q.onwrite())
    lease ? run(lease.connection) : place({ run, q, reject: error => q.reject(queryError(error, q, options.debug)) })
  }

  function unbuilt(q, error, lease) {
    error = queryError(error, q, options.debug)
    if (!lease || lease.released || lease.connection.closed)
      return q.reject(error)

    q.connection = lease.connection
    lease.connection.local(q, error)
    q.onwrite && q.onwrite()
  }

  function place(job, lease) {
    used = true
    const missing = !lease && retype()

    if (missing)
      return reject(job, missing)

    if (job.q && job.q.cancelled)
      return job.q.reject(queryError(Errors.generic('57014', 'canceling statement due to user request'), job.q, options.debug))

    if (lease) {
      return lease.connection.closed ? job.q.reject(queryError(lease.connection.closed, job.q, options.debug))
        : lease.released ? job.q.reject(queryError(ended(lease), job.q, options.debug))
        : run(lease.connection, job)
    }

    if (signal.aborted)
      return reject(job, Errors.connection('CONNECTION_DESTROYED', options, options.host[0], options.port[0]))

    if (failingFast())
      return reject(job, copy(failure.error))

    const c = waiting.length === 0 && pick(job)
    if (c)
      return run(c, job)

    waiting.push(wait(job))
    drain()
  }

  function wait(job) {
    if (!options.queue_timeout)
      return job

    job.timer = setTimeout(() => {
      job.timer = null
      waiting.remove(x => x === job) && reject(job, Errors.generic(
        'QUEUE_TIMEOUT', 'Waited more than ' + options.queue_timeout + ' seconds for a connection'
      ))
    }, options.queue_timeout * 1000)
    typeof job.timer.unref === 'function' && job.timer.unref()
    return job
  }

  function started(job) {
    job.timer && (clearTimeout(job.timer), job.timer = null)
  }

  function run(c, job) {
    started(job)
    hold(c)

    if (job.run)
      return job.run(c)

    job.q.connection = c
    job.simple !== undefined
      ? c.simple(job.q, job.simple)
      : c.send(job.q)
    job.q.onwrite && job.q.onwrite()
  }

  function drain() {
    while (waiting.length) {
      const job = waiting.peek()
          , c = pick(job)

      if (!c && !copying(job))
        break

      waiting.shift()
      !c ? reject(job, Errors.generic('COPY_IN_PROGRESS', 'You cannot execute queries during copy'))
        : job.lease ? grant(c, job)
        : run(c, job)
    }
    waiting.length && listened(channels.pool) && event('wait', null, { waiting: waiting.length })
    grow()
  }

  function plain(job) {
    return !!job.q && !job.lease && !job.exclusive && !job.run
  }

  function copying(job) {
    if (!job.q || connections.size + opening < options.max || connections.size === 0)
      return false

    for (const c of connections) {
      if (!c.copying)
        return false
    }
    return true
  }

  function usable(c) {
    return !c.closed && !c.closing && !c.lease && !c.releasing && !c.retiring && !c.exclusive && !c.loading
  }

  function pick(job) {
    const statement = job.statement
        , any = !statement || !statement.name

    let best = null

    for (const c of connections) {
      const free = usable(c)
      if (free && c.inflight === 0) {
        if (any || c.prepared.has(statement.name))
          return c
        best = best && best.inflight === 0 ? best : c
      } else if (free && !job.lease && !job.exclusive
        && c.inflight < options.max_pipeline && (!best || c.inflight < best.inflight)) {
        best = c
      }
    }

    if (best && best.inflight === 0)
      return best

    if (connections.size + opening < options.max && !failingSince)
      return null

    best && options.scheduler && job.q && needed(job) && (best = scheduled(job) || best)
    return best && opening && best.inflight >= Math.ceil(waiting.length / (opening + 1))
      ? null
      : best
  }

  function needed(job) {
    if (!job.q.cost || job.q.cost.est === undefined || job.q.cost.est >= notable)
      return true

    for (const c of connections) {
      if (c.notable)
        return true
    }

    return false
  }

  function scheduled(job) {
    const t = now()
        , e = job.q.cost ? job.q.cost.est : undefined

    if (e === undefined || e < slow)
      return soonest(t, Infinity, false)

    let heavy = 0
    for (const c of connections)
      c.inflight && c.heavy() && heavy++

    decay(t)
    const reserve = Math.max(1, Math.min(Math.ceil(work.fast / 2000 * 1.5) + 1, connections.size - Math.ceil(work.slow / 2000)))
    return heavy < connections.size - reserve
      ? soonest(t, Infinity, false)
      : soonest(t, 2 * e, true) || soonest(t, Infinity, false)
  }

  function soonest(t, most, heavy) {
    let best = null
      , value = Infinity
      , ties = 0

    for (const c of connections) {
      const v = usable(c) && c.inflight < options.max_pipeline && (!heavy || c.heavy()) ? c.backlog(t) : Infinity
      if (v <= most && v < value)
        (best = c, value = v, ties = 1)
      else if (v <= most && v === value && v !== Infinity && Math.random() * ++ties < 1)
        best = c
    }

    return best
  }

  function ontimed(sample, t) {
    decay(t)
    sample < slow ? work.fast += sample : work.slow += sample
  }

  function decay(t) {
    const d = Math.exp((work.at - t) / 2000)
    work.fast *= d
    work.slow *= d
    work.at = t
  }

  function grow() {
    if (ending && waiting.length === 0)
      return

    if (failingSince !== null) {
      if (opening || !waiting.length || retryTimer || [...connections].some(x => x.loading))
        return
      const wait = nextAttempt - now()
      return wait > 0
        ? (retryTimer = setTimeout(() => (retryTimer = null, grow()), wait))
        : connect()
    }

    let loading = 0
    for (const c of connections)
      c.loading && loading++

    const wanted = Math.max(
      Math.min(waiting.length - opening - loading, options.max - connections.size - opening),
      used && !ending ? Math.min(options.min, options.max) - connections.size - opening : 0
    )

    for (let i = 0; i < wanted; i++)
      connect()
  }

  function connect() {
    opening++
    retryTimer && (clearTimeout(retryTimer), retryTimer = null)
    ;(options.open || startup)(options, signal, replacing.length ? replacing.shift() : 0).then(opened, failed)
  }

  function copy(error) {
    if (!error || typeof error !== 'object')
      return error

    const x = Object.create(Object.getPrototypeOf(error), Object.getOwnPropertyDescriptors(error))
    Object.defineProperty(x, 'stack', { value: error.stack, writable: true, configurable: true })
    ;['query', 'parameters', 'args', 'types'].forEach(k => delete x[k])
    return x
  }

  function failingFast() {
    return !!failure && retries > 1 && opening === 0 && now() < nextAttempt && stuck()
  }

  function stuck() {
    for (const c of connections) {
      if (!c.lease)
        return false
    }
    return true
  }

  function opened(ready) {
    opening--

    if (signal.aborted || (ending && waiting.length === 0)) {
      ready.socket.destroy()
      return finishing()
    }

    Object.entries(ready.parameters).forEach(([k, v]) => onparameter(k, v))
    const c = Connection(ready, options, events)
    c.index = ready.index || 0
    connections.add(c)
    lifetime(c)
    listened(channels.pool) && event('open', c)
    typesLoaded || typesLoading ? (c.loading = !typesLoaded) : loadTypes(c)
    c.loading || recovered()
    drain()
  }

  function recovered() {
    retries = 0
    failingSince = null
    failure = null
  }

  function retype() {
    if (!typesError)
      return null

    if (now() - typesFailed < 1000)
      return copy(typesError)

    typesError = null
    connections.forEach(x => x.loading = true)
    ;[...connections].some(x => !x.closed && (loadTypes(x), true))
    return null
  }

  function loadTypes(c) {
    hold(c)
    typesLoading = true
    c.loading = true
    types.load(text => new Promise((resolve, reject) => {
      const q = new Query([text], [], Object.assign(() => {}, { options }), { simple: true })
      q.executed = true
      q.then(resolve, reject)
      c.simple(q, text)
    })).then(() => typesLoaded = true, error => error instanceof PostgresError
      ? typesLoaded = true
      : error && error.code === 'TYPE_NOT_FOUND' && (typesError = error, typesFailed = now())
    ).then(() => {
      typesLoading = false
      connections.forEach(x => x.loading = !typesLoaded && !typesError)
      ;(typesLoaded || typesError) && recovered()
      typesError
        ? waiting.take().forEach(job => reject(job, copy(typesError)))
        : typesLoaded || [...connections].some(x => !x.closed && (loadTypes(x), true))
      drain()
    })
  }

  function failed(error) {
    opening--
    if (signal.aborted)
      return finishing()

    attempted(error)
    ending ? finishing() : grow()
  }

  function attempted(error) {
    failingSince === null && (failingSince = now())
    retries++
    nextAttempt = now() + 1000 * (typeof options.backoff === 'function' ? options.backoff(retries) : options.backoff)

    const transient = !!error && (error.code === 'CONNECTION_CLOSED' || error.code === '53300')
        , expired = options.connect_timeout && now() - failingSince >= options.connect_timeout * 1000

    failure = !transient || expired ? { error } : null
    stuck() && opening === 0 && (failure || ending) && waiting.take().forEach((job, i) => reject(job, i ? copy(error) : error))
  }

  function reject(job, error) {
    started(job)
    job.lease ? job.reject(error) : job.q ? job.q.reject(queryError(error, job.q, options.debug)) : job.reject(error)
  }

  function lifetime(c) {
    const life = typeof options.max_lifetime === 'function' ? options.max_lifetime() : options.max_lifetime
    life && (c.lifeTimer = unref(setTimeout(() => {
      c.retiring = true
      c.inflight === 0 && !c.lease && c.close()
    }, life * 1000)))
    idle(c)
  }

  function event(name, c, extra) {
    channels.pool.publish({
      event: name,
      connection: c ? c.id : null,
      host: c ? c.host : null,
      port: c ? c.port : null,
      database: options.database,
      stats: pool.stats,
      ...extra
    })
  }

  function idle(c) {
    listened(channels.pool) && event('idle', c)
    if (c.inflight || c.lease)
      return

    options.unref_sockets && !c.loading && waiting.length === 0 && c.unref()
    if (!options.idle_timeout)
      return

    c.idleSince = now()
    c.idleTimer || (c.idleTimer = unref(setTimeout(() => idled(c), options.idle_timeout * 1000)))
  }

  function hold(c) {
    options.unref_sockets && c.ref()
  }

  function unref(timer) {
    options.unref_sockets && timer && typeof timer.unref === 'function' && timer.unref()
    return timer
  }

  function idled(c) {
    c.idleTimer = null
    if (c.inflight || c.lease || c.closed)
      return

    if (connections.size <= options.min)
      return

    const left = options.idle_timeout * 1000 - (now() - c.idleSince)
    left >= 1
      ? c.idleTimer = unref(setTimeout(() => idled(c), left))
      : c.close()
  }

  function onready(c) {
    if (c.releasing) {
      if (c.inflight)
        return

      c.releasing = false
      if (c.status !== 'I')
        return c.close()
    }
    if (c.inflight === 0 && !c.lease && (c.retiring || (ending && waiting.length === 0)))
      return c.close()

    idle(c)
    while (waiting.length > connections.size && usable(c) && c.inflight < options.max_pipeline && plain(waiting.peek()))
      run(c, waiting.shift())

    waiting.length && !c.lease && c.inflight < options.max_pipeline && drain()
    ending && waiting.length === 0 && finishing()
  }

  function onclose(c, error) {
    connections.delete(c)
    c.loading && !signal.aborted && attempted(copy(error))
    ending || replacing.push((c.index + 1) % (options.path ? 1 : options.host.length))
    replacing.length > options.max && replacing.shift()
    c.retired && c.retired.forEach(r => r())
    c.idleTimer && clearTimeout(c.idleTimer)
    c.lifeTimer && clearTimeout(c.lifeTimer)
    c.lease && c.lease.onclose && c.lease.onclose(
      error.cause && error.cause.severity === 'FATAL' ? error.cause
      : error.code === 'CONNECTION_DESTROYED' ? Errors.connection('CONNECTION_CLOSED', options, c.host, c.port)
      : error
    )
    options.onclose && options.onclose(c.id)
    listened(channels.pool) && event('close', c, { error })
    connections.size === 0 && opening === 0 && statements.clear()
    drain()
    ending && finishing()
  }

  function onparameter(k, v) {
    options.parameters[k] !== v && (options.parameters[k] = v, options.onparameter && options.onparameter(k, v))
  }

  async function lease(kind) {
    used = true
    await 1
    if (ending)
      throw Errors.connection('CONNECTION_ENDED', options, options.host[0], options.port[0])

    if (failingFast())
      throw copy(failure.error)

    const missing = retype()
    if (missing)
      throw missing

    return new Promise((resolve, reject) => {
      waiting.push(wait({ lease: true, kind, resolve, reject, queued: listened(channels.pool) ? now() : 0 }))
      drain()
    })
  }

  function grant(c, job) {
    started(job)
    hold(c)
    c.idleTimer && (clearTimeout(c.idleTimer), c.idleTimer = null)
    let chain = Promise.resolve()
      , released = false
      , lost

    const closed = new Promise((_, reject) => lost = reject)
    closed.catch(() => {})

    const x = {
      kind: job.kind,
      error: null,
      connection: c,
      closed,
      get released() { return released },
      send(q) {
        if (c.closed)
          return q.reject(queryError(c.closed, q, options.debug))

        if (released)
          return q.reject(queryError(ended(x), q, options.debug))

        chain = chain.then(() => new Promise(resolve => {
          q.onwrite = resolve
          q.then(resolve, resolve)
          query(q, x)
        }))
      },
      release() {
        if (released)
          return
        released = true
        c.lease === x && (c.lease = null)
        listened(channels.pool) && event('release', c, { kind: job.kind })
        if (c.closed)
          return

        if (c.inflight)
          return (c.releasing = true)

        c.status === 'I' ? onready(c) : c.close()
      },
      onclose(error) {
        x.error = error
        lost(error)
      }
    }

    c.lease = x
    listened(channels.pool) && event('lease', c, { kind: job.kind, waited: job.queued ? now() - job.queued : 0 })
    job.resolve(x)
  }

  function ended(lease) {
    return Errors.generic('UNSAFE_TRANSACTION', 'The ' + lease.kind + ' has ended')
  }

  function cancel(q) {
    if (waiting.remove(x => x.q === q && (started(x), true))) {
      q.reject(queryError(Errors.generic('57014', 'canceling statement due to user request'), q, options.debug))
      return Promise.resolve()
    }

    if (q.connection)
      return q.connection.cancel(q)

    q.cancelled = true
    return Promise.resolve()
  }

  function end({ timeout = null } = {}) {
    if (ending)
      return ending

    ending = new Promise(resolve => {
      pool.ended = resolve
      timeout !== null && (endTimer = setTimeout(destroy, timeout * 1000))
      retryTimer && (clearTimeout(retryTimer), retryTimer = null)
      Promise.resolve().then(finishing)
    })

    return ending
  }

  function finishing() {
    if (!pool.ended)
      return

    if (waiting.length === 0)
      connections.forEach(c => c.inflight === 0 && !c.lease && c.close())

    if (connections.size === 0 && opening === 0 && waiting.length) {
      const error = Errors.connection('CONNECTION_ENDED', options, options.host[0], options.port[0])
      waiting.take().forEach(job => reject(job, error))
    }

    if (connections.size === 0 && (opening === 0 || signal.aborted) && waiting.length === 0) {
      endTimer && clearTimeout(endTimer)
      retryTimer && clearTimeout(retryTimer)
      const resolve = pool.ended
      pool.ended = null
      resolve()
    }
  }

  function destroy() {
    endTimer = null
    signal.aborted = true
    signal.sockets.forEach(x => x.destroy())
    const error = Errors.connection('CONNECTION_DESTROYED', options, options.host[0], options.port[0])
    waiting.take().forEach(job => reject(job, error))
    connections.forEach(c => c.destroy())
    connections.size === 0 && finishing()
  }

  function close() {
    used = false
    return Promise.all([...connections].map(c => c.lease
      ? new Promise(r => (c.retiring = true, (c.retired || (c.retired = [])).push(r)))
      : c.close()
    ))
  }
}

export function Queue() {
  let xs = []
    , head = 0

  return {
    get length() { return xs.length - head },
    push: x => xs.push(x),
    peek: () => xs[head],
    shift() {
      const x = xs[head]
      xs[head++] = undefined
      head === xs.length ? (xs = [], head = 0) : head > 1024 && head * 2 > xs.length && (xs = xs.slice(head), head = 0)
      return x
    },
    take() {
      const all = xs.slice(head)
      xs = []
      head = 0
      return all
    },
    remove(fn) {
      for (let i = head; i < xs.length; i++) {
        if (fn(xs[i]))
          return (xs.splice(i, 1), true)
      }
      return false
    }
  }
}

const limit = 2000

function alone(x) {
  return x.alone === undefined
    ? x.alone = opens(x.text)
    : x.alone
}

function opens(text) {
  if (begins.test(text))
    return true

  starts.lastIndex = 0
  let match
  while ((match = starts.exec(text))) {
    const from = match.index + 5
    let i = from
    while (true) {
      while (i < text.length && /\s/.test(text[i]))
        i++

      if (text[i] !== '/' || text[i + 1] !== '*')
        break

      const end = text.indexOf('*/', i + 2)
      if (end === -1)
        return false

      i = end + 2
    }

    if (i > from && transaction.test(text.slice(i, i + 12)))
      return true

    starts.lastIndex = Math.max(starts.lastIndex, i)
  }

  return false
}

function Statements(scheduler) {
  const prefix = Math.random().toString(36).slice(2, 10)
      , map = new Map()
      , templates = new WeakMap()

  let counter = 1
    , clock = 0

  const texts = new Map()

  return { get, clear, known }

  function known(text) {
    let x = texts.get(text)
    if (x)
      return x

    texts.set(text, x = { text, est: undefined, alone: undefined })
    texts.size > limit && texts.delete(texts.keys().next().value)
    return x
  }

  function get(built, prepare) {
    if (!prepare)
      return unnamed(built.text)

    const tagged = !built.dynamic && (templates.get(built.strings) || set(built.strings))
        , cached = tagged && tagged.get(built.types)

    if (cached && cached.live)
      return (cached.used = clock++, cached)

    const key = built.types + '\0' + built.text
    let statement = map.get(key)
    statement ? statement.used = clock++ : statement = add(key, built.text)
    tagged && tagged.set(built.types, statement)
    return statement
  }

  function unnamed(text) {
    return {
      key: null, live: false, name: '', text, ends: undefined, shape: undefined, version: 0, used: 0,
      cost: scheduler ? known(text) : null
    }
  }

  function add(key, text) {
    const statement = {
      key, live: true, name: prefix + counter++, text, ends: undefined, shape: undefined, version: 0, used: clock++,
      cost: { est: undefined }, alone: undefined
    }
    map.set(key, statement)
    map.size > limit && evict()
    return statement
  }

  function evict() {
    let oldest = null
    for (const x of map.values())
      (!oldest || x.used < oldest.used) && (oldest = x)
    oldest.live = false
    map.delete(oldest.key)
  }

  function set(strings) {
    const x = new Map()
    templates.set(strings, x)
    return x
  }

  function clear() {
    map.forEach(x => x.live = false)
    map.clear()
  }
}
