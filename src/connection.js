import Stream from 'stream'
import * as p from './protocol.js'
import { Errors, queryError } from './errors.js'
import Result from './result.js'
import { CLOSE, Query } from './query.js'
import { now, channels, listened } from './diagnostics.js'

export const slow = 100
export const notable = 5

const text = p.text
    , noop = () => {}
    , ending = /^\s*(commit|end|abort|rollback(?!\s+to\b)|prepare\s+transaction)\b/i
    , limit = 1000
    , refused = 'postgres.js: query could not be built'
    , skip = Symbol('skip')
    , held = Symbol('held')
    , unknown = 100
    , states = new WeakMap()
    , after = 16
    , variety = 16

let ids = 1
  , compiles = true

export function Connection(ready, options, events) {
  const { socket } = ready
      , timers = options.timers
      , defer = timers.nextTick || process.nextTick
      , { transform } = options
      , sent = []
      , pending = []
      , running = new Set()
      , open = new Set()
      , prepared = new Map()
      , out = p.Writer()
      , frames = p.Frames(frame, socket.shared, error => (connection.fatal = error, socket.destroy()))

  let blocker = null
    , stash = null
    , heard = timers.now()
    , rolling = false
    , fence = null
    , drained = null
    , status = ready.status
    , flushing = false
    , closed = null
    , closing = null
    , portals = 0
    , traced = 0
    , epoch = 0
    , headSince = 0
    , notables = 0

  const connection = {
    id: ids++,
    host: ready.host,
    port: ready.port,
    backend: ready.backend,
    parameters: ready.parameters,
    prepared,
    lease: null,
    get status() { return status },
    get inflight() { return sent.length + pending.length },
    get exclusive() { return !!blocker && exclusive(blocker) },
    get copying() { return !!blocker && blocker.streaming && blocker.open },
    get closed() { return closed },
    get closing() { return !!closing },
    send,
    batch,
    simple,
    describe,
    local,
    cancel,
    close,
    destroy,
    go,
    ref: () => socket.ref(),
    unref: () => socket.unref(),
    backlog,
    heavy,
    get notable() { return notables > 0 }
  }

  socket.ondata = x => (heard = timers.now(), frames.push(x))
  socket.ondrain = ondrain
  socket.onclose = onclose
  ready.rest && ready.rest.length && frames.push(ready.rest)
  socket.resume()

  return connection

  function ondrain() {
    const x = drained
    drained = null
    x && x()
  }

  function schedule(now) {
    if (now || out.length >= 65536)
      return flush()

    flushing || (flushing = true, defer(flush))
    return true
  }

  function flush() {
    flushing = false
    if (closed)
      return (out.take(), true)

    return out.length ? socket.write(out.take()) : true
  }

  function holds(x) {
    return x.describing
      || (x.described && socket.serial && !x.nosync && !x.done)
      || (x.gate && x.learn && !x.error)
      || (!!x.error && !x.done)
      || (x.flushing && !x.synced)
      || (x.streaming && x.open)
      || (x.alone && !x.done)
  }

  function exclusive(x) {
    return x.flushing || x.streaming || x.alone
  }

  function refresh() {
    blocker && !holds(blocker) && (blocker = null)
    release()
  }

  function queue(x) {
    if (closed)
      return settleError(x, copy(closed))

    if (blocker && blocker.streaming && blocker.open)
      return settleError(x, Errors.generic('COPY_IN_PROGRESS', 'You cannot execute queries during copy'))

    x.query && (x.query.state = connection.backend)
    if (fence)
      pending.splice(pending.indexOf(fence), 0, x)
    else if (x.ends && open.size)
      pending.push(fence = x)
    else if (blocker || pending.length)
      pending.push(x)
    else
      return (write(x), schedule())

    release()
  }

  function release() {
    while (!blocker && pending.length && pending[0] !== fence)
      write(pending.shift())

    schedule()
  }

  function write(x) {
    if (x.kind === 'local' && sent.length === 0)
      return queueMicrotask(() => settle(x))

    const mark = out.length
    let result
    try {
      result = x.write(x)
    } catch (error) {
      x.own = error
      result = skip
    }
    if (result === held) {
      out.truncate(mark)
      x.loose = false
      blocker = sent.find(y => y.gate && holds(y)) || null
      blocker && blocker.nosync && !blocker.flushed && (blocker.flushed = true, p.flush(out), schedule())
      return pending.unshift(x)
    }

    if (result === skip) {
      out.truncate(mark)
      x.fresh = null
      x.parses = []
      x.portal = ''
      x.describing = x.synced = x.flushing = x.open = false
      if (x.batch) {
        x.entry = null
        p.parse(out, '', refused)
        x.parses = ['']
        abort(x)
      } else if (!x.own || x.kind === 'step' || !connection.lease) {
        x.kind = 'local'
        x.cost >= notable && notables--
        x.cost = undefined
        return sent.length === 0 ? queueMicrotask(() => settle(x)) : sent.push(x)
      } else {
        x.kind = 'simple'
        x.text = refused
        x.results = []
        x.entry = null
        sync(x, true)
      }
    }
    x.fresh && register(x.fresh)
    x.portal && x.kind === 'query' && open.add(x)
    x.query && (x.query.active = sent.length === 0)
    x.ends && epoch++
    x.epoch = epoch
    options.scheduler && sent.length === 0 && (headSince = timers.now())
    sent.push(x)
    holds(x) && (blocker = x)
    x.trace && wrote(x)
  }

  function sync(x, refuse) {
    if (x.synced)
      return

    x.synced = true
    refuse ? p.query(out, refused) : p.sync(out)
    schedule()
  }

  function register(entry) {
    const current = prepared.get(entry.name)
    current && prepared.delete(entry.name)
    prepared.set(entry.name, entry)
    entry.owner.entry = entry
    entry.owner.fresh = null
    if (prepared.size <= limit)
      return

    for (const [name, x] of prepared) {
      if (x.state !== 'parsing') {
        prepared.delete(name)
        p.close(out, 'S', name)
        return
      }
    }
  }

  function drop(entry) {
    prepared.get(entry.name) === entry && prepared.delete(entry.name)
  }

  function send(query) {
    const { statement } = query.wire
        , x = Exchange('query', query, connection.lease, extended)

    x.statement = statement
    x.ends = statement.ends === undefined ? (statement.ends = ending.test(statement.text)) : statement.ends
    options.scheduler && cost(x)
    queue(x)
  }

  function batch(query, parts) {
    const b = {
      query, parts, results: new Array(parts.length), settled: new Array(parts.length).fill(false),
      left: parts.length, error: null, index: -1, aborted: null
    }

    parts.forEach((part, i) => {
      part.resolve = result => batched(b, i, null, result)
      part.reject = error => batched(b, i, error)
      if (b.aborted)
        return batched(b, i, skipped(b.aborted, i))

      const x = Exchange('query', part, connection.lease, extended)
      x.statement = part.wire.statement
      x.ends = x.statement.ends === undefined ? (x.statement.ends = ending.test(x.statement.text)) : x.statement.ends
      x.batch = b
      x.nosync = i < parts.length - 1
      options.scheduler && cost(x)
      queue(x)
    })
  }

  function batched(b, i, error, result) {
    if (b.settled[i])
      return

    b.settled[i] = true
    b.left--
    error
      ? (b.error === null || (i < b.index && !error.skipped)) && (b.error = error, b.index = i)
      : b.results[i] = result

    if (b.left)
      return

    const { query, parts, results } = b
    if (b.error) {
      b.error.index = b.index
      parts.forEach((part, j) => {
        Query.prototype.reject.call(part, j === b.index ? b.error : skipped(b.error, b.index))
        part.catch(noop)
      })
      return query.reject(b.error)
    }

    parts.forEach((part, j) => Query.prototype.resolve.call(part, results[j]))
    query.resolve(results)
  }

  function skipped(error, index) {
    const x = copy(error)
    x.index = index
    x.skipped = true
    return x
  }

  function part(x) {
    sent.shift()
    options.scheduler && timed(x)
    x.done = true
    x.open = false
    x.trace && traced--
    blocker === x && (blocker = null)
    settle(x)
    const next = sent[0]
    if (next && next.query) {
      next.query.active = true
      next.cancel && turn(next)
    }
    release()
  }

  function abort(x) {
    if (x.aborted)
      return

    x.aborted = true
    const b = x.batch
        , error = x.own || x.error

    b.aborted = error
    let synced = !x.nosync && x.synced
    const at = sent.indexOf(x)
    for (let i = at === -1 ? sent.length : at + 1; i < sent.length;) {
      const y = sent[i]
      if (y.batch === b) {
        sent.splice(i, 1)
        synced = synced || (!y.nosync && y.synced)
        drop(y)
        blocker === y && (blocker = null)
      } else {
        i++
      }
    }

    for (let i = 0; i < pending.length;) {
      const y = pending[i]
      y.batch === b ? (pending.splice(i, 1), drop(y)) : i++
    }

    synced || p.sync(out)
    x.nosync = false
    x.synced = true
    schedule()

    function drop(y) {
      y.entry && y.entry.owner === y && y.entry.state === 'parsing' && (y.entry.state = 'stale')
      y.done = true
      y.trace && traced--
      y.cost >= notable && notables--
      settleError(y, skipped(error, b.parts.indexOf(y.query)))
    }
  }

  function cost(x) {
    const { query } = x
    query.cost && !query.cursorFn && !query.streaming && (x.cost = query.cost.est === undefined ? unknown : query.cost.est)
    x.cost >= notable && notables++
  }

  function timed(x) {
    const t = timers.now()

    if (x.cost !== undefined) {
      x.cost >= notable && notables--
      const sample = t - headSince
          , c = x.query.cost
      c.est = c.est === undefined || sample > c.est ? sample : c.est + (sample - c.est) * 0.1
      events.ontimed && events.ontimed(sample, t)
    }

    headSince = t
  }

  function backlog(t) {
    let w = 0
    for (let i = 0; i < sent.length; i++) {
      const e = sent[i].cost || 0
      if (i === 0) {
        const elapsed = t - headSince
        w += elapsed < e ? e - elapsed : elapsed
      } else {
        w += e
      }
    }

    for (let i = 0; i < pending.length; i++)
      w += pending[i].cost || 0

    return w
  }

  function heavy() {
    for (let i = 0; i < sent.length; i++) {
      if (sent[i].cost >= slow)
        return true
    }

    for (let i = 0; i < pending.length; i++) {
      if (pending[i].cost >= slow)
        return true
    }

    return false
  }

  function extended(x) {
    const { query } = x
        , { built } = query.wire
        , statement = x.statement
        , name = statement.name
        , current = name ? prepared.get(name) : null

    if (query.cursorFn) {
      x.rows = query.cursorRows
      x.portal = transaction() ? 'c' + portals++ : ''
      x.flushing = !x.portal
    }

    x.streaming = x.open = !!query.streaming

    if (current && current.state === 'parsing' && current.oids === null && current.owner && !current.owner.error) {
      if (!current.owner.loose)
        throw Errors.generic('STATEMENT_PENDING', 'A statement was used before its description arrived')

      current.owner.gate = true
      return held
    }

    if (current && current !== x.previous && usable(current, statement)) {
      const b = query.isRaw === true || query.ownParsers ? null : binaries(current)
      x.entry = current
      x.columns = b ? b.columns : current.columns
      x.formats = b ? b.formats : null
      x.values = serialize(current.oids, built, current)
      return run(x, name)
    }

    if (x.retried) {
      x.verify = true
      p.parse(out, '', statement.text, built.oids)
      p.describe(out, 'S', '')
      p.flush(out)
      x.describing = true
      return
    }

    const typed = !inferred(built)
    name && (x.fresh = Entry(name, x, typed ? built.oids : null))
    current && p.close(out, 'S', name)
    parse(x, name, statement.text, built.oids)
    p.describe(out, 'S', name)

    if (!typed && !loose(x, built)) {
      p.flush(out)
      x.describing = true
      return
    }

    x.learn = true
    x.values = typed ? serialize(built.oids, built, x.fresh || {}) : untyped(built)
    run(x, name)
  }

  function binaries(entry) {
    if (entry.binaryOf === entry.columns)
      return entry.binary

    const columns = entry.columns
        , formats = new Array(columns.length)

    let binary = null
    for (let i = 0; i < columns.length; i++) {
      const decode = events.binary(columns[i].type)
      formats[i] = decode ? 1 : 0
      decode && ((binary || (binary = columns.slice()))[i] = { ...columns[i], decode })
    }

    entry.binaryOf = columns
    return entry.binary = binary && { columns: binary, formats }
  }

  function loose(x, built) {
    if (!events.plain || x.query.cursorFn || x.streaming)
      return false

    const { oids, values } = built
    for (let i = 0; i < oids.length; i++) {
      if (!oids[i] && values[i] !== null && !(typeof values[i] === 'number' && isFinite(values[i])))
        return false
    }
    return x.loose = true
  }

  function untyped(built) {
    const { oids, values } = built
        , out = new Array(values.length)

    for (let i = 0; i < values.length; i++)
      out[i] = values[i] === null ? null : oids[i] ? events.serializer(oids[i])(values[i]) : '' + values[i]

    return out
  }

  function parse(x, name, text, oids) {
    p.parse(out, name, text, oids)
    x.parses.push(name)
  }

  function run(x, name) {
    const mark = out.length
    try {
      x.nosync
        ? (p.bind(out, x.portal, name, x.values, undefined, x.formats || undefined), p.execute(out, x.portal, x.rows))
        : p.run(out, x.portal, name, x.values, x.rows, x.flushing, x.formats)
    } catch (error) {
      out.truncate(mark)
      throw error
    }
    x.flushing || (x.synced = true)
    const oids = x.entry ? x.entry.oids : x.params || (x.loose ? null : x.query.wire.built.oids)
    oids ? debug(x.statement.text, x.values, oids) : (x.later = true)
  }

  function logged(item, oids) {
    item.later && oids && (item.later = false, debug(item.statement.text, item.values, oids))
  }

  function usable(entry, statement) {
    return entry.oids !== null && (entry.state === 'parsing' || (entry.state === 'ready' && entry.version === statement.version))
  }

  function learned(entry, statement) {
    const shape = entry.oids.join() + ':' + entry.columns.map(x => x.type).join()
    if (statement.shape !== shape) {
      statement.shape === undefined || statement.version++
      statement.shape = shape
    }
    entry.version = statement.version
  }

  function inferred(built) {
    for (let i = 0; i < built.oids.length; i++) {
      if (!built.oids[i])
        return true
    }
    return false
  }

  function serialize(oids, built, cache) {
    const serializers = cache.serializers || (cache.serializers = oids.map(events.serializer))
        , values = built.values
        , out = new Array(values.length)

    for (let i = 0; i < values.length; i++) {
      out[i] = values[i] === null ? null : serializers[i](values[i])
      out[i] === null || out[i] === undefined || typeof out[i] === 'string' || out[i] instanceof Uint8Array || Buffer.byteLength(out[i])
    }

    return out
  }

  function transaction() {
    return !!connection.lease && connection.lease.kind === 'transaction'
  }

  function described(x) {
    x.describing = false
    x.described = true
    const { built } = x.query.wire
        , name = x.statement.name
        , params = x.params || []
        , columns = x.columns || []

    try {
      if (x.verify) {
        const previous = x.previous
        if (previous && same(previous, params, columns)) {
          if (x.original) {
            x.own = x.original
            return sync(x)
          }
        } else if (previous) {
          stale(previous)
          x.statement.version++
        }
        x.values = serialize(params, built, {})
        return run(x, '')
      }
      const entry = x.entry
      entry && (entry.oids = params, entry.columns = columns, learned(entry, x.statement))
      x.values = serialize(params, built, entry || {})
      run(x, name)
    } catch (error) {
      x.own = error
      x.batch ? (p.parse(out, '', refused), x.parses.push(''), abort(x)) : sync(x, !!connection.lease)
    }
  }

  function same(entry, params, columns) {
    const a = entry.oids || []
        , b = entry.columns

    return !!b
      && a.length === params.length && params.every((x, i) => x === a[i])
      && b.length === columns.length && columns.every((x, i) => x.type === b[i].type)
  }

  function describe(statement, oids, query) {
    return new Promise((resolve, reject) => {
      const x = Exchange('describe', null, connection.lease, x => {
        p.parse(out, '', statement.text, oids)
        p.describe(out, 'S', '')
        sync(x)
      })
      x.for = query || null
      x.resolve = resolve
      x.reject = reject
      queue(x)
    })
  }

  function simple(query, sql) {
    const x = Exchange('simple', query, connection.lease, x => {
      debug(sql, [], [])
      p.query(out, sql)
      x.synced = true
    })
    x.text = sql
    x.results = []
    x.ends = ending.test(sql)
    x.streaming = x.open = !!query.streaming
    options.scheduler && cost(x)
    queue(x)
  }

  function local(query, error) {
    queue(Exchange('query', query, connection.lease, () => { throw error }))
  }

  function cancel(query) {
    if (query.parts)
      return cancelBatch(query)

    if (stash && sent[0] && sent[0].query === query) {
      sent[0].own = Errors.generic('57014', 'canceling statement due to user request')
      go()
      return Promise.resolve()
    }

    if (running.has(query) || (sent[0] && sent[0].query === query && sent[0].awaiting))
      return (query.aborted = Errors.generic('57014', 'canceling statement due to user request'), Promise.resolve())
    const i = pending.findIndex(x => x.query === query || x.for === query)

    if (i !== -1) {
      const [x] = pending.splice(i, 1)
      x === fence && (fence = null)
      x.cost >= notable && notables--
      settleError(x, Errors.generic('57014', 'canceling statement due to user request'))
      release()
      return Promise.resolve()
    }

    const x = sent.find(x => x.query === query || x.for === query)
    if (!x)
      return Promise.resolve()

    if (x === sent[0] && x.completed)
      return (expect(x), Promise.resolve())

    if (x === sent[0] && (query.active || x.for))
      return cancelling(x)

    quiet(x)
    return new Promise((resolve, reject) => x.cancel = { resolve, reject })
  }

  function turn(x) {
    x.silence && (timers.clearTimeout(x.silence), x.silence = null)
    const go = () => {
      x.silence = null
      if (closed || x.done || sent[0] !== x)
        return x.cancel.resolve()

      if (x.completed)
        return (expect(x), x.cancel.resolve())

      cancelling(x).then(x.cancel.resolve, x.cancel.reject)
    }

    x.query && x.query.timedOut && options.query_timeout
      ? x.silence = timers.setTimeout(go, options.query_timeout * 1000)
      : defer(go)
  }

  function quiet(x) {
    if (!options.cancel_timeout || x.silence)
      return

    const ms = options.cancel_timeout * 1000
        , check = () => {
          x.silence = null
          const query = x.query || x.for
          if (closed || x.done || !query || query.settled)
            return

          const idle = timers.now() - heard
          idle >= ms
            ? destroy(Errors.generic('CANCEL_UNANSWERED', 'The server sent nothing within cancel_timeout (' + options.cancel_timeout + ' seconds) while a canceled query waited, so whether it ran is unknown'))
            : x.silence = timers.setTimeout(check, ms - idle)
        }

    x.silence = timers.setTimeout(check, ms)
  }

  function cancelling(x) {
    expect(x)
    return ready.cancel()
  }

  function expect(x) {
    options.cancel_timeout && !x.unanswered && (x.unanswered = timers.setTimeout(() => unanswered(x), options.cancel_timeout * 1000))
  }

  function unanswered(x) {
    x.unanswered = null
    const query = x.batch ? x.batch.query : x.query || x.for
    if (closed || (x.done && !x.batch) || !query || query.settled)
      return

    destroy(Errors.generic(
      'CANCEL_UNANSWERED',
      'The server did not answer within cancel_timeout (' + options.cancel_timeout + ' seconds) after a query was canceled, '
        + 'so whether it ran is unknown'
    ))
  }

  function answered(x) {
    x.silence && (timers.clearTimeout(x.silence), x.silence = null)
    x.unanswered && (!x.batch || x.batch.query.settled) && (timers.clearTimeout(x.unanswered), x.unanswered = null)
  }

  function cancelBatch(query) {
    const x = sent.find(x => x.batch && x.batch.query === query)
    if (x)
      return x === sent[0] ? cancelling(x) : new Promise((resolve, reject) => x.cancel = { resolve, reject })

    const first = pending.find(x => x.batch && x.batch.query === query)
    if (first) {
      first.own = Errors.generic('57014', 'canceling statement due to user request')
      first.write = () => { throw first.own }
    }
    return Promise.resolve()
  }

  function close() {
    closing || (closing = new Promise(r => {
      connection.onended = r
      idle() && terminate()
    }))
    return closing
  }

  function idle() {
    return sent.length === 0 && pending.length === 0
  }

  function terminate() {
    if (closed)
      return connection.onended && connection.onended()

    flush()
    socket.end(p.Terminate())
  }

  function destroy(error) {
    closing || (closing = Promise.resolve())
    socket.destroy(error)
  }

  function onclose(error) {
    if (closed)
      return

    out.take()
    blocker = null
    fence = null
    notables = 0
    const head = sent[0]
        , failed = head && head.error && head.error.severity === 'FATAL' ? head.error : null
        , fatal = connection.fatal || failed
    connection.uncertain = !!(fatal && head && head.ends)
    closed = Errors.connection(closing ? 'CONNECTION_DESTROYED' : 'CONNECTION_CLOSED', options, ready.host, ready.port)
    closed.cause = fatal || error || undefined
    sent.concat(pending).forEach(x => x.cancel && x.cancel.resolve())
    sent.splice(0).forEach(x => {
      x.stream && x.stream.destroy(closed)
      x.own ? settle(x)
        : failed ? settleError(x, x === head ? failed : copy(failed))
        : settleError(x, copy(closed))
    })
    pending.splice(0).forEach(x => x.own ? settle(x) : settleError(x, copy(closed)))
    running.forEach(query => query.settled || query.reject(decorate(query, copy(closed))))
    running.clear()
    open.clear()
    connection.onended && connection.onended()
    events.onclose(connection, closed)
  }

  function decorate(query, error) {
    return queryError(error, query, options.debug)
  }

  function settleError(x, error) {
    answered(x)
    x.kind === 'describe'
      ? x.reject(error)
      : x.query && !x.query.settled && x.query.reject(decorate(x.query, error))
  }

  function debug(text, values, oids) {
    typeof options.debug === 'function' && options.debug(connection.id, text, values, oids)
  }

  function wrote(x) {
    const trace = x.trace
    traced++
    trace.query = x.text || x.statement.text
    trace.statement = x.statement ? x.statement.name : ''
    trace.parameters = options.debug ? x.query.parameters : undefined
    trace.connection = connection.id
    trace.host = connection.host
    trace.port = connection.port
    trace.sent = now()
  }

  function first() {
    const x = sent[0]
    x && x.trace && x.trace.firstByte === null && (x.trace.firstByte = now())
  }

  function frame(type, x, start, end) {
    if (!events.typed && stash === null && (type === 84 || type === 116)
      && events.unknown(type === 84 ? p.rowDescription(x, start, end, oidOf) : p.parameterDescription(x, start))) {
      stash = { type, x: Buffer.from(x.subarray(start, end)) }
      frames.pause()
      return events.need(connection)
    }

    dispatch(type, x, start, end)
  }

  function go() {
    if (!stash)
      return

    const { type, x } = stash
    dispatch(type, x, 0, x.length)
    stash = null
    frames.resume()
  }

  function dispatch(type, x, start, end) {
    traced && first()
    try {
      type === 68 ? DataRow(x, start) :
        type === 100 ? CopyData(x, start, end) :
        type === 90 ? ReadyForQuery(x, start) :
        type === 67 ? CommandComplete(x, start, end) :
        type === 50 ? BindComplete() :
        type === 49 ? ParseComplete() :
        type === 51 ? null :
        type === 116 ? ParameterDescription(x, start) :
        type === 84 ? RowDescription(x, start) :
        type === 110 ? NoData() :
        type === 69 ? ErrorResponse(x, start, end) :
        type === 115 ? PortalSuspended() :
        type === 73 ? EmptyQueryResponse() :
        type === 65 ? NotificationResponse(x, start) :
        type === 78 ? NoticeResponse(x, start, end) :
        type === 83 ? ParameterStatus(x, start) :
        type === 71 ? CopyInResponse() :
        type === 72 ? CopyOutResponse() :
        type === 87 ? CopyBothResponse() :
        type === 99 ? CopyDone() :
        type === 86 ? unsupported('FunctionCallResponse') :
        type === 118 ? unsupported('NegotiateProtocolVersion') :
        null
    } catch (error) {
      const x = sent[0]
      x ? fail(x, error) : destroy(error)
    }
    blocker && !holds(blocker) && (blocker = null, release())
    out.length && schedule()
  }

  function fail(x, error) {
    x.error = x.error || error
    x.describing = false
    x.open = false
    x.batch ? abort(x) : sync(x)
  }

  function unsupported(x) {
    sent[0] && fail(sent[0], Errors.notSupported(x))
  }

  function ParseComplete() {
    const x = sent[0]
        , name = x.parses.shift()

    name && x.entry && x.entry.name === name && x.entry.owner === x && x.entry.state === 'parsing' && (x.entry.state = 'ready')
  }

  function BindComplete() {
    const x = sent[0]
    x.bound = true
    if (!x.columns && x.entry) {
      x.columns = x.entry.columns
      x.result.columns = x.columns
    }
  }

  function ParameterDescription(x, start) {
    const item = sent[0]
    item.params = p.parameterDescription(x, start)
    item.loose && item.entry && item.entry.owner === item && item.entry.oids === null && (item.entry.oids = item.params)
    logged(item, item.params)
  }

  function RowDescription(x, start) {
    received(sent[0], p.rowDescription(x, start, 0, column))
  }

  function NoData() {
    received(sent[0], [])
  }

  function received(x, columns) {
    if (x.kind === 'simple' && x.result.command !== null) {
      x.results.push(x.result)
      x.result = new Result()
    }
    x.columns = columns
    x.result.columns = columns
    if (x.learn) {
      x.learn = false
      x.entry && x.entry.owner === x && (x.entry.columns = columns, learned(x.entry, x.statement))
    }
    x.describing && described(x)
  }

  function column(name, table, number, type) {
    const parser = events.parser(type)
    return {
      name: transform.column.from ? transform.column.from(name) : name,
      parser: parser.identity ? null : parser,
      decode: events.decoder(type, parser),
      table,
      number,
      type
    }
  }

  function DataRow(x, start) {
    const item = sent[0]
        , { query } = item
        , raw = query.isRaw
        , from = raw !== true ? transform.value.from : null
        , shape = item.shaped === item.columns ? item.reader : (item.shaped = item.columns, item.reader = query.ownParsers && raw !== true ? Parsed(item.columns, query.ownParsers) : Rows(item.columns))
        , columns = shape.columns
        , fast = raw !== true && read(shape, !!raw, text, from)
        , n = columns.length
        , result = item.result

    let row
    if (fast) {
      row = fast(x, start + 7)
    } else {
      row = raw ? new Array(n) : {}
      let i = start + 7
      for (let j = 0; j < n; j++) {
        const length = (x[i] << 24) | (x[i + 1] << 16) | (x[i + 2] << 8) | x[i + 3]
            , column = columns[j]
        i += 4
        let value = null
        if (length !== -1) {
          value = raw === true
            ? Buffer.from(x.subarray(i, i + length))
            : column.decode
              ? column.decode(x, i, i + length)
              : column.parser
                ? column.parser(text(x, i, i + length))
                : text(x, i, i + length)
          i += length
        }
        from && (value = from(value, column))
        raw ? row[j] = value : column.name === '__proto__' ? own(row, column.name, value) : row[column.name] = value
      }
    }

    const out = transform.row.from ? transform.row.from(row) : row
    query.forEachFn
      ? query.forEachFn(out, result)
      : result[result.length] = out
  }

  function CommandComplete(x, start, end) {
    const item = sent[0]
        , { command, count } = p.commandComplete(x, start, end)
        , result = item.result

    result.command = command
    result.count = count
    result.state = connection.backend
    result.statement = item
    item.query && (item.query.source = item)
    item.kind === 'simple' || (result.columns = result.columns || item.columns)

    item.final && (item.stream && Object.assign(item.stream, { count, command }), item.final(), item.final = null)
    item.kind !== 'simple' && (item.completed = true)

    if (item.kind === 'simple') {
      item.results.push(item.result)
      item.result = new Result()
      return
    }

    if (item.rows) {
      item.finished = true
      item.flushing && sync(item)
      if (result.count || result.length)
        (item.last = new Promise(r => r(item.query.cursorFn(result)))).catch(noop)
    }

    item.nosync && !item.error && part(item)
  }

  function unsafe(item) {
    const error = () => Errors.generic('UNSAFE_TRANSACTION', 'Only use sql.begin, sql.reserved or max: 1')
    rolling = true
    item.own = error()
    sent.forEach(x => x.kind !== 'local' && (x.own = error()))
    pending.unshift(Exchange('internal', null, null, x => (p.query(out, 'rollback'), x.synced = true)))
  }

  function EmptyQueryResponse() {
    const item = sent[0]
    item.kind === 'simple' && (item.results.push(item.result), item.result = new Result())
    item.nosync && !item.error && part(item)
  }

  async function PortalSuspended() {
    const item = sent[0]
    if (!item.flushing)
      return (item.suspended = true)

    try {
      item.awaiting = true
      const next = await item.query.cursorFn(item.result)
      item.awaiting = false
      item.result = new Result()
      if (closed || item.synced || sent[0] !== item)
        return
      if (item.query.aborted)
        throw item.query.aborted
      next === CLOSE
        ? (p.close(out, 'P', ''), sync(item))
        : (p.execute(out, '', item.rows), p.flush(out), schedule())
    } catch (error) {
      item.awaiting = false
      if (closed || item.synced || sent[0] !== item)
        return
      fail(item, error)
    }

    refresh()
  }

  function ErrorResponse(x, start, end) {
    const item = sent[0]
        , error = Errors.postgres(p.error(x, start, end))

    if (!item)
      return (connection.fatal = error)

    item.stream && item.stream.destroy(error)
    item.final && (item.final(error), item.final = null)
    fail(item, error)
  }

  function ReadyForQuery(x, start) {
    status = p.readyForQuery(x, start)
    frames.own(false)
    const item = sent.shift()
    options.scheduler && timed(item)
    item.done = true
    item.open = false
    item.trace && traced--
    item.kind === 'internal' && (rolling = false)
    status !== 'I' && !rolling && !item.lease && !connection.lease && options.max !== 1 && unsafe(item)
    blocker === item && (blocker = null)
    settle(item)
    item.entry && item.entry.owner === item && (item.entry.owner = null)
    while (sent.length && sent[0].kind === 'local')
      settle(sent.shift())
    release()

    const next = sent[0]
    if (next && next.query) {
      next.query.active = true
      next.cancel && turn(next)
    }

    closing && idle() && terminate()
    events.onready(connection)
  }

  function settle(x) {
    answered(x)
    settling(x)
    x.batch && answered(x)
  }

  function settling(x) {
    if (x.kind === 'internal')
      return

    if (x.kind === 'describe') {
      return x.error
        ? x.reject(x.error)
        : x.resolve({ params: x.params || [], columns: x.columns })
    }

    const { query } = x
        , cursor = x.origin || (x.portal ? x : null)

    cursor && (x.own || x.error || !x.suspended) && unfence(cursor)

    if (x.own)
      return query.reject(decorate(query, x.own))

    if (x.error)
      return failed(x)

    if (x.suspended)
      return suspended(x)

    x.last
      ? x.last.then(() => query.settled || finish(x), error => query.settled || query.reject(decorate(query, error)))
      : query.settled || finish(x)
  }

  function unfence(cursor) {
    if (!open.delete(cursor) || open.size || !fence)
      return
    fence = null
    release()
  }

  function failed(x) {
    const entry = x.kind === 'query' ? x.entry : null
    const parsing = x.fresh || (entry && entry.owner === x && entry.state === 'parsing')

    if (x.error.code === '42P05' && x.kind === 'query' && x.statement.name && parsing) {
      entry && drop(entry)
      x.statement.name += '_'
      return retryable(x) ? again(x, null) : settleError(x, x.error)
    }

    if (!entry)
      return settleError(x, x.error)

    if (entry.owner === x && entry.state === 'parsing')
      return (drop(entry), settleError(x, x.error))

    if (x.error.code === '26000') {
      drop(entry)
      return retryable(x) ? again(x, null) : settleError(x, x.error)
    }

    if (x.bound)
      return settleError(x, x.error)

    if (retryable(x))
      return again(x, x.error)

    stale(entry)
    settleError(x, x.error)
  }

  function stale(entry) {
    prepared.get(entry.name) === entry && (entry.state = 'stale')
  }

  function retryable(x) {
    return !x.retried
        && !x.batch
        && !x.cancel
        && !x.query.cancelled
        && !x.query.cursorFn
        && !x.streaming
        && x.lease === connection.lease
        && status === 'I'
        && !closing
        && (sent.length === 0 || (!x.lease && options.max !== 1))
  }

  function again(x, original) {
    const retry = Exchange('query', x.query, x.lease, extended)
    retry.statement = x.statement
    retry.ends = x.ends
    retry.retried = true
    retry.original = original
    retry.previous = x.entry
    retry.trace = x.trace
    retry.cost = x.cost

    if (sent.length)
      return queue(retry)

    pending.unshift(retry)
    release()
  }

  function suspended(x) {
    const cursor = x.origin || x
        , { query } = x

    running.add(query)

    new Promise(r => r(query.cursorFn(x.result))).then(next => {
      running.delete(query)
      if (query.settled)
        return unfence(cursor)
      queue(step(cursor, next === CLOSE || !!query.aborted, query.aborted || null))
    }, error => {
      running.delete(query)
      if (query.settled)
        return unfence(cursor)
      queue(step(cursor, true, error))
    })
  }

  function step(cursor, end, failure) {
    const x = Exchange('step', cursor.query, cursor.lease, stepped)
    x.origin = cursor
    x.statement = cursor.statement
    x.entry = cursor.entry
    x.columns = cursor.columns
    x.portal = cursor.portal
    x.rows = cursor.rows
    x.end = end
    x.failure = failure
    return x
  }

  function stepped(x) {
    const cursor = x.origin

    if (connection.lease !== cursor.lease || cursor.epoch !== epoch) {
      if (x.failure)
        throw x.failure
      if (!x.end)
        throw outlived()
      return skip
    }

    x.own = x.failure
    x.end ? p.close(out, 'P', x.portal) : p.execute(out, x.portal, x.rows)
    sync(x)
  }

  function outlived() {
    return Errors.generic('UNSAFE_TRANSACTION', 'The cursor outlived its transaction')
  }

  function finish(x) {
    const { query } = x

    if (x.kind === 'simple') {
      x.result.command !== null && x.results.push(x.result)
      const results = x.results
      return query.resolve(results.length > 1 ? results : results[0] || x.result)
    }

    query.resolve(x.result)
  }

  function NotificationResponse(x, start) {
    const { pid, channel, payload } = p.notification(x, start)
    events.onnotify && guard(events.onnotify, channel, payload, pid)
  }

  function guard(fn, ...xs) {
    try {
      fn(...xs)
    } catch (error) {
      noop(error)
    }
  }

  function NoticeResponse(x, start, end) {
    const notice = p.error(x, start, end)
    listened(channels.notice) && channels.notice.publish({
      notice,
      connection: connection.id,
      host: connection.host,
      port: connection.port,
      database: options.database
    })
    options.onnotice
      ? guard(options.onnotice, notice)
      : options.onnotice === false || console.log(notice) // eslint-disable-line
  }

  function ParameterStatus(x, start) {
    const [k, v] = p.parameterStatus(x, start)
    connection.parameters[k] = v
    events.onparameter && guard(events.onparameter, k, v)
  }

  function writeData(chunk, callback) {
    p.copyData(out, chunk)
    flush() ? callback() : (drained = callback)
  }

  function writable(item) {
    return {
      autoDestroy: true,
      write(chunk, encoding, callback) {
        writeData(chunk, callback)
      },
      destroy(error, callback) {
        callback(error)
        item.stream = null
        if (!item.copied && !closed && !item.error) {
          p.copyFail(out, (error || 'The COPY stream was destroyed') + '')
          item.copied = true
          item.open = false
          schedule(true)
          refresh()
        }
      },
      final(callback) {
        p.copyDone(out)
        item.copied = true
        item.open = false
        item.final = callback
        schedule(true)
        refresh()
      }
    }
  }

  function CopyInResponse() {
    const item = sent[0]
    item.stream = new Stream.Writable(writable(item))
    item.query.resolve(item.stream)
  }

  function readable(item) {
    return () => {
      item.wanted = true

      if (!frames.paused)
        return

      frames.resume()
      frames.paused || socket.resume()
    }
  }

  function abandoned(item) {
    return (error, callback) => {
      callback(error)
      if (!item.stream)
        return

      item.stream = null
      if (frames.paused) {
        frames.resume()
        frames.paused || socket.resume()
      }
    }
  }

  function CopyOutResponse() {
    const item = sent[0]
    item.stream = new Stream.Readable({ read: readable(item), destroy: abandoned(item) })
    item.open = false
    frames.own(true)
    item.query.resolve(item.stream)
  }

  function CopyBothResponse() {
    const item = sent[0]
    item.stream = new Stream.Duplex({ ...writable(item), read: readable(item) })
    frames.own(true)
    item.query.resolve(item.stream)
  }

  function CopyData(x, start, end) {
    const item = sent[0]

    if (!item.stream)
      return

    item.wanted = false
    if (!item.stream.push(frames.owns(x) ? x.subarray(start + 5, end) : Buffer.from(x.subarray(start + 5, end))) && !item.wanted) {
      frames.pause()
      socket.pause()
    }
  }

  function CopyDone() {
    frames.own(false)
    const item = sent[0]
    item.stream && item.stream.push(null)
    item.stream = null
  }
}

function oidOf(name, table, number, type) {
  return type
}

function copy(error) {
  const x = Object.create(Object.getPrototypeOf(error), Object.getOwnPropertyDescriptors(error))
  Object.defineProperty(x, 'stack', { value: error.stack, writable: true, configurable: true })
  ;['query', 'parameters', 'args', 'types'].forEach(k => delete x[k])
  return x
}

function key(name) {
  const x = JSON.stringify(String(name))
  return name === '__proto__' ? '[' + x + ']' : x
}

export function own(row, name, value) {
  Object.defineProperty(row, name, { value, writable: true, enumerable: true, configurable: true })
}

function Exchange(kind, query, lease, write) {
  return {
    kind,
    query,
    lease,
    write,
    trace: query && query.trace || null,
    statement: null,
    text: '',
    entry: null,
    fresh: null,
    previous: null,
    parses: [],
    values: null,
    params: null,
    columns: null,
    shaped: null,
    reader: null,
    result: new Result(),
    results: null,
    origin: null,
    portal: '',
    rows: 0,
    end: false,
    failure: null,
    flushing: false,
    streaming: false,
    open: false,
    alone: !!(query && query.alone),
    describing: false,
    learn: false,
    batch: null,
    nosync: false,
    aborted: false,
    flushed: false,
    loose: false,
    gate: false,
    later: false,
    formats: null,
    verify: false,
    synced: false,
    bound: false,
    suspended: false,
    finished: false,
    done: false,
    ends: false,
    epoch: 0,
    retried: false,
    original: null,
    error: null,
    own: null,
    cancel: null,
    unanswered: null,
    silence: null,
    completed: false,
    for: null,
    stream: null,
    copied: false,
    wanted: false,
    final: null,
    resolve: null,
    reject: null,
    cost: undefined
  }
}

function Entry(name, owner, oids) {
  return { name, owner, oids, columns: null, serializers: null, binary: null, binaryOf: null, state: 'parsing', version: -1 }
}

function Rows(columns) {
  let state = states.get(columns)
  if (state === undefined) {
    state = {
      columns,
      seen: 0,
      object: null,
      array: null,
      variants: null,
      compilable: compiles && columns.length <= 512 && !columns.some(x => String(x.name) === '__proto__')
    }
    states.set(columns, state)
  }
  return state
}

function Parsed(columns, parsers) {
  const state = Rows(columns)
      , list = columns.map(typeof parsers === 'function'
        ? c => parsers(c) || null
        : c => c.type in parsers ? parsers[c.type] || null : c.parser
      )

  if (list.every((x, i) => x === columns[i].parser))
    return state

  const variants = state.variants || (state.variants = [])
      , found = variants.find(v => v.list.every((x, i) => x === list[i]))

  if (found)
    return found.state

  const variant = { list, state: Rows(columns.map((c, i) => list[i] === c.parser ? c : { ...c, parser: list[i], decode: null })) }
  variants.length === variety && variants.shift()
  variants.push(variant)
  return variant.state
}

function read(state, array, text, from) {
  const key = array ? 'array' : 'object'

  if (state[key] !== null)
    return state[key]

  if (!state.compilable || ++state.seen < after)
    return null

  try {
    return state[key] = compile(state.columns, array, text, from)
  } catch (_) {
    compiles = state.compilable = false
    return null
  }
}

function compile(columns, array, text, from) {
  const locals = []
      , body = ['let l = 0']
      , at = 'x, i, i + l'

  columns.forEach((c, j) => {
    c.decode
      ? locals.push('d' + j + ' = c[' + j + '].decode')
      : c.parser && locals.push('p' + j + ' = c[' + j + '].parser')
    const value = c.decode ? 'd' + j + '(' + at + ')' : c.parser ? 'p' + j + '(text(' + at + '))' : 'text(' + at + ')'
    body.push(
      'l = (x[i] << 24) | (x[i + 1] << 16) | (x[i + 2] << 8) | x[i + 3]',
      'i += 4',
      'let v' + j + ' = null',
      'l !== -1 && (v' + j + ' = ' + value + ', i += l)',
      from ? 'v' + j + ' = from(v' + j + ', c[' + j + '])' : ''
    )
  })

  body.push(array
    ? 'return [' + columns.map((c, j) => 'v' + j).join(',') + ']'
    : 'return {' + columns.map((c, j) => key(c.name) + ':v' + j).join(',') + '}'
  )

  return new Function('c', 'text', 'from', // eslint-disable-line
    (locals.length ? 'const ' + locals.join(', ') + '\n' : '') +
    'return function row(x, i) {\n' + body.filter(Boolean).join('\n') + '\n}'
  )(columns, text, from)
}
