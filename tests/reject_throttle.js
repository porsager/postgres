import { t } from './test.js' // eslint-disable-line
import net from 'net'

import postgres from '../src/index.js'

const delay = ms => new Promise(r => setTimeout(r, ms))

// The real test database (bootstrapped by tests/bootstrap.js).
const REAL = { host: '127.0.0.1', port: 5432, db: 'postgres_js_test', user: 'postgres_js_test' }

// A controllable stand-in for the database endpoint.
//
// It records the timestamp of every inbound connection attempt, and for the first
// `rejectFirst` of them it reads the client's startup packet and then closes the
// socket CLEANLY (FIN) — which is what drives postgres.js down the establishment
// *reconnect* path (`if (initial) return reconnect()`), the path reject_throttle
// governs. (A destroy()/RST would instead take the error path and reject the query
// outright, never reaching the reconnect logic.) Once past `rejectFirst`, it
// transparently proxies to the real postgres so genuine handshakes complete and the
// breaker can recover.
function endpoint({ rejectFirst = Infinity } = {}) {
  const attempts = []
  const sockets = new Set()
  const server = net.createServer(client => {
    attempts.push(Date.now())
    sockets.add(client)
    client.on('error', () => {})
    client.on('close', () => sockets.delete(client))
    if (attempts.length <= rejectFirst) {
      client.on('data', () => client.end())   // clean FIN after startup => establishment reconnect
      return
    }
    // Proxy to the real database. Track the upstream socket alongside the client one:
    // it is a live pg backend, and if close() only tears down the client side the
    // upstream can stay ESTABLISHED, keeping the event loop alive long after the
    // suite finishes (the harness relies on a natural exit) — an occasional CI hang.
    const up = net.connect(REAL.port, REAL.host)
    sockets.add(up)
    up.on('error', () => client.destroy())
    up.on('close', () => sockets.delete(up))
    up.pipe(client)
    client.pipe(up)
  })
  return {
    attempts,
    listen: () => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port))),
    close: () => {
      sockets.forEach(s => s.destroy())
      return new Promise(r => server.close(r))
    }
  }
}

const opts = (port, extra) => ({
  host: '127.0.0.1',
  port,
  db: REAL.db,
  user: REAL.user,
  connect_timeout: 1,
  ...extra
})

// ---------------------------------------------------------------------------
// Option + state plumbing
// ---------------------------------------------------------------------------

t('reject_throttle defaults to false', async() =>
  [false, postgres({ max: 1 }).options.reject_throttle]
)

t('reject_throttle can be enabled via options', async() =>
  [true, postgres({ max: 1, reject_throttle: true }).options.reject_throttle]
)

t('reject_throttle reads from the connection string', async() => {
  // Non-int query params stay strings in postgres.js (as for prepare/ssl/…): 'true'
  // is truthy so the feature enables, and 'false' is coerced to boolean false.
  const on = postgres('postgres://localhost/db?reject_throttle=true').options.reject_throttle
  const off = postgres('postgres://localhost/db?reject_throttle=false').options.reject_throttle
  return ['true,false', [!!on, off].join(',')]
})

t('throttle state is initialised on shared', async() => {
  const th = postgres({ max: 1 }).options.shared.throttle
  return ['true,1,0', [th.prober === null, th.ramp, th.allowance].join(',')]
})

// ---------------------------------------------------------------------------
// The core: an establishment-failure storm is throttled when enabled, and is a
// herd when not.
// ---------------------------------------------------------------------------

t('off: establishment failures herd (hundreds of attempts)', { timeout: 10 }, async() => {
  const ep = endpoint()                       // always rejects (clean FIN)
  const port = await ep.listen()
  const sql = postgres(opts(port, { max: 5, reject_throttle: false }))
  for (let i = 0; i < 5; i++) sql`select 1`.catch(() => {})
  await delay(400)
  const attempts = ep.attempts.length
  const engaged = sql.options.shared.throttle.prober !== null
  await sql.end({ timeout: 0 }).catch(() => {})
  await ep.close()
  // vanilla retries each of the 5 connections immediately => a flood; breaker idle
  return ['true,false', [attempts > 100, engaged].join(',')]
})

t('on: establishment failures are throttled to a trickle', { timeout: 10 }, async() => {
  const ep = endpoint()                       // always rejects
  const port = await ep.listen()
  const sql = postgres(opts(port, { max: 5, reject_throttle: true }))
  for (let i = 0; i < 5; i++) sql`select 1`.catch(() => {})
  await delay(400)
  const attempts = ep.attempts.length
  const engaged = sql.options.shared.throttle.prober !== null
  await sql.end({ timeout: 0 }).catch(() => {})
  await ep.close()
  // initial burst (<=max) + a few paced prober retries; two orders of magnitude fewer
  return ['true,true', [attempts < 30, engaged].join(',')]
})

t('on: a single prober keeps probing after the burst', { timeout: 10 }, async() => {
  const ep = endpoint()
  const port = await ep.listen()
  const sql = postgres(opts(port, { max: 5, reject_throttle: true }))
  for (let i = 0; i < 5; i++) sql`select 1`.catch(() => {})
  await delay(250)                            // let the burst + stand-downs settle
  const before = ep.attempts.length
  await delay(700)                            // one prober-retry window
  const after = ep.attempts.length
  await sql.end({ timeout: 0 }).catch(() => {})
  await ep.close()
  // only the lone prober retries in this window — a small handful, not another burst
  return [true, (after - before) <= 6]
})

t('on: ramp collapses to baseline while blocked', { timeout: 10 }, async() => {
  const ep = endpoint()
  const port = await ep.listen()
  const sql = postgres(opts(port, { max: 5, reject_throttle: true }))
  for (let i = 0; i < 5; i++) sql`select 1`.catch(() => {})
  await delay(300)
  const th = sql.options.shared.throttle
  const state = [th.ramp, th.allowance].join(',')
  await sql.end({ timeout: 0 }).catch(() => {})
  await ep.close()
  return ['1,0', state]
})

// ---------------------------------------------------------------------------
// Recovery: once the endpoint accepts again, queued work drains and the breaker
// disengages back to baseline.
// ---------------------------------------------------------------------------

t('recovery: queries resolve once the endpoint accepts', { timeout: 15 }, async() => {
  const ep = endpoint({ rejectFirst: 3 })     // reject 3, then proxy to real pg
  const port = await ep.listen()
  const sql = postgres(opts(port, { max: 3, reject_throttle: true }))
  const results = await Promise.all([sql`select 1 as x`, sql`select 2 as x`, sql`select 3 as x`])
    .then(rs => rs.map(r => r[0].x).join(','))
    .catch(e => 'ERR:' + (e.code || e.message))
  await sql.end({ timeout: 0 }).catch(() => {})
  await ep.close()
  return ['1,2,3', results]
})

t('recovery: breaker disengages to baseline after draining', { timeout: 15 }, async() => {
  const ep = endpoint({ rejectFirst: 4 })
  const port = await ep.listen()
  const sql = postgres(opts(port, { max: 3, reject_throttle: true }))
  await Promise.all([sql`select 1`, sql`select 2`, sql`select 3`]).catch(() => {})
  await delay(150)                            // let the final onopen run
  const th = sql.options.shared.throttle
  const state = [th.prober === null, th.ramp, th.allowance].join(',')
  await sql.end({ timeout: 0 }).catch(() => {})
  await ep.close()
  return ['true,1,0', state]
})

t('recovery: works after a large reject streak', { timeout: 20 }, async() => {
  const ep = endpoint({ rejectFirst: 10 })
  const port = await ep.listen()
  const sql = postgres(opts(port, { max: 5, reject_throttle: true }))
  const ok = await Promise.all(Array.from({ length: 5 }, (_, i) => sql`select ${i} as x`))
    .then(rs => rs.map(r => r[0].x).join(','))
    .catch(e => 'ERR:' + (e.code || e.message))
  await delay(150)
  const disengaged = sql.options.shared.throttle.prober === null
  await sql.end({ timeout: 0 }).catch(() => {})
  await ep.close()
  return ['0,1,2,3,4|true', ok + '|' + disengaged]
})

// ---------------------------------------------------------------------------
// Feature-off is byte-for-byte vanilla against a healthy endpoint.
// ---------------------------------------------------------------------------

t('off: normal queries against a healthy endpoint are unaffected', async() => {
  const sql = postgres({ ...REAL, max: 1, reject_throttle: false })
  const x = (await sql`select 42 as x`)[0].x
  await sql.end({ timeout: 0 }).catch(() => {})
  return [42, x]
})

t('on: normal queries against a healthy endpoint still work', async() => {
  const sql = postgres({ ...REAL, max: 1, reject_throttle: true })
  const x = (await sql`select 42 as x`)[0].x
  const idle = sql.options.shared.throttle.prober === null
  await sql.end({ timeout: 0 }).catch(() => {})
  return ['42,true', [x, idle].join(',')]
})

// ---------------------------------------------------------------------------
// More coverage
// ---------------------------------------------------------------------------

t('off: never touches the throttle state', { timeout: 10 }, async() => {
  const ep = endpoint()
  const port = await ep.listen()
  const sql = postgres(opts(port, { max: 5, reject_throttle: false }))
  for (let i = 0; i < 5; i++) sql`select 1`.catch(() => {})
  await delay(300)
  const th = sql.options.shared.throttle
  const state = [th.prober === null, th.ramp, th.allowance].join(',')
  await sql.end({ timeout: 0 }).catch(() => {})
  await ep.close()
  return ['true,1,0', state]
})

t('on: a backlog far exceeding max is still throttled', { timeout: 10 }, async() => {
  const ep = endpoint()
  const port = await ep.listen()
  const sql = postgres(opts(port, { max: 3, reject_throttle: true }))
  for (let i = 0; i < 30; i++) sql`select 1`.catch(() => {})
  await delay(400)
  const attempts = ep.attempts.length
  await sql.end({ timeout: 0 }).catch(() => {})
  await ep.close()
  // 30 queued queries, but only <=max open at once + the lone prober's retries
  return [true, attempts < 30]
})

t('on: max:1 recovers through the lone prober', { timeout: 15 }, async() => {
  const ep = endpoint({ rejectFirst: 3 })
  const port = await ep.listen()
  const sql = postgres(opts(port, { max: 1, reject_throttle: true }))
  const x = await sql`select 7 as x`.then(r => r[0].x).catch(e => 'ERR:' + (e.code || e.message))
  await delay(150)
  const disengaged = sql.options.shared.throttle.prober === null
  await sql.end({ timeout: 0 }).catch(() => {})
  await ep.close()
  return ['7,true', [x, disengaged].join(',')]
})

t('recovery: drains a large backlog and disengages', { timeout: 20 }, async() => {
  const ep = endpoint({ rejectFirst: 5 })
  const port = await ep.listen()
  const sql = postgres(opts(port, { max: 4, reject_throttle: true }))
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => sql`select ${i} as x`))
    .then(rs => rs.map(r => r[0].x).join(','))
    .catch(e => 'ERR:' + (e.code || e.message))
  await delay(200)
  const disengaged = sql.options.shared.throttle.prober === null
  await sql.end({ timeout: 0 }).catch(() => {})
  await ep.close()
  return ['0,1,2,3,4,5,6,7,8,9,10,11|true', results + '|' + disengaged]
})

t('on: max_lifetime recycle still reconnects (drop path intact)', { timeout: 10 }, async() => {
  const sql = postgres({ ...REAL, max: 1, reject_throttle: true, max_lifetime: 0.1, idle_timeout: 1 })
  const a = (await sql`select 1 as x`)[0].x
  await delay(300)                            // exceed max_lifetime => connection recycles (drop path)
  const b = (await sql`select 2 as x`)[0].x
  const idle = sql.options.shared.throttle.prober === null
  await sql.end({ timeout: 0 }).catch(() => {})
  return ['1,2,true', [a, b, idle].join(',')]
})

// ---------------------------------------------------------------------------
// Boundaries: the breaker governs ONLY the clean-close establishment-reconnect
// path. Error-close (RST) and connect-timeout must still reject, not hang.
// ---------------------------------------------------------------------------

t('on: an establishment connection error still rejects (not the reconnect path)', { timeout: 10 }, async() => {
  // Bind then immediately release a port so connecting to it yields ECONNREFUSED —
  // a genuine establishment *error* (socket 'error' => errored() rejects and clears
  // `initial`, so closed() never takes the reconnect branch), which the breaker must
  // pass straight through. A server-side destroy() is deliberately NOT used here: it
  // isn't portable, because on Linux the socket is often torn down before the client's
  // startup packet lands, which the client sees as a clean mid-handshake close => the
  // throttled reconnect path => the query never settles. ECONNREFUSED is deterministic
  // across OSes and Node versions.
  const probe = net.createServer()
  const port = await new Promise(r => probe.listen(0, '127.0.0.1', () => r(probe.address().port)))
  await new Promise(r => probe.close(r))
  const sql = postgres(opts(port, { max: 1, reject_throttle: true }))
  const settled = await sql`select 1`.then(() => 'RESOLVED', e => e.code || 'ERR')
  await sql.end({ timeout: 0 }).catch(() => {})
  // it must settle (with an error) rather than hang in a reconnect loop
  return [true, settled !== 'RESOLVED']
})

t('on: connect_timeout still fires (not swallowed by the breaker)', { timeout: 10 }, async() => {
  const socks = new Set()
  const server = net.createServer(c => (socks.add(c), c.on('close', () => socks.delete(c)))) // accepts, never responds
  const port = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)))
  const sql = postgres(opts(port, { max: 1, reject_throttle: true, connect_timeout: 0.3 }))
  const code = await sql`select 1`.then(() => 'RESOLVED', e => e.code)
  await sql.end({ timeout: 0 }).catch(() => {})
  socks.forEach(s => s.destroy())
  await new Promise(r => server.close(r))
  return ['CONNECT_TIMEOUT', code]
})

t('on drives ~orders-of-magnitude fewer attempts than off', { timeout: 12 }, async() => {
  async function count(reject_throttle) {
    const ep = endpoint()
    const port = await ep.listen()
    const sql = postgres(opts(port, { max: 5, reject_throttle }))
    for (let i = 0; i < 5; i++) sql`select 1`.catch(() => {})
    await delay(400)
    const n = ep.attempts.length
    await sql.end({ timeout: 0 }).catch(() => {})
    await ep.close()
    return n
  }
  const off = await count(false)
  const on = await count(true)
  return [true, off > on * 10]
})
