import { postgres, options, delay } from './setup.js'

const seconds = +process.argv[2] || +process.env.SOAK_SECONDS || 60
    , started = Date.now()
    , deadline = started + seconds * 1000
    , app = 'soak-' + process.pid
    , sql = postgres({ ...options, max: 10, idle_timeout: 2, max_lifetime: 30, connection: { application_name: app } })
    , admin = postgres({ ...options, max: 1 })
    , pending = new Map()
    , samples = []
    , failures = []
    , counts = {}

let next = 0
  , notified = 0

await sql`create table if not exists soak (id serial primary key, x int, s text)`
await sql`truncate soak`
await sql.listen('soak', () => notified++)

const kinds = {
  select: () => sql`select ${ next }::int as x`,
  shape: () => sql.unsafe('select $1::int as x_' + (next % 500), [next]),
  rows: () => sql`select generate_series(1, 2000) as n`,
  insert: () => sql`insert into soak (x, s) values (${ next }, ${ 'x'.repeat(next % 100) })`,
  begin: () => sql.begin(async sql => {
    await sql`insert into soak (x) values (${ next })`
    await sql`select count(*) from soak`
    next % 7 === 0 && sql`select 1/0`.catch(() => {})
  }).catch(e => ['22012', '25P02', 'TRANSACTION_ROLLED_BACK'].includes(e.code) || Promise.reject(e)),
  cursor: async() => {
    for await (const rows of sql`select generate_series(1, 300) as n`.cursor(50))
      rows.length
  },
  copy: async() => {
    let bytes = 0
    for await (const x of await sql`copy (select generate_series(1, 5000)) to stdout`.readable())
      bytes += x.length
    return bytes
  },
  notify: () => sql.notify('soak', 'x' + next),
  cancel: () => {
    const q = sql`select pg_sleep(0.2)`
    setTimeout(() => q.cancel().catch(() => {}), Math.random() * 100)
    return q.catch(e => e.code === '57014' || Promise.reject(e))
  },
  reserve: async() => {
    const reserved = await sql.reserve()
    try {
      await reserved`select 1`
    } finally {
      reserved.release()
    }
  }
}

const expected = new Set(['57P01', 'CONNECTION_CLOSED', 'CONNECTION_DESTROYED', 'ECONNRESET', '57014', '25P02', '40P01', '08006'])

function operation() {
  const id = next++
      , names = Object.keys(kinds)
      , name = names[id % names.length]
      , at = Date.now()
  pending.set(id, { name, at })
  return Promise.resolve().then(kinds[name]).then(
    () => counts[name] = (counts[name] || 0) + 1,
    error => expected.has(error.code) || failures.push(name + ': ' + (error.code || '') + ' ' + error.message)
  ).finally(() => pending.delete(id))
}

async function worker() {
  while (Date.now() < deadline)
    await operation()
}

async function faults() {
  while (Date.now() < deadline) {
    await delay(500 + Math.random() * 2500)
    Math.random() < 0.8
      ? await admin`
        select pg_terminate_backend(pid) from pg_stat_activity
        where application_name = ${ app } and pid in (
          select pid from pg_stat_activity where application_name = ${ app } order by random() limit 1
        )
      `.catch(() => {})
      : await sql.close()
  }
}

async function sample() {
  while (Date.now() < deadline) {
    await delay(Math.max(1000, seconds * 10))
    global.gc && global.gc()
    const [{ n }] = await admin`select count(*)::int as n from pg_stat_activity where application_name = ${ app }`
        , oldest = Math.max(0, ...[...pending.values()].map(x => Date.now() - x.at))
    samples.push({
      t: (Date.now() - started) / 1000,
      heap: process.memoryUsage().heapUsed / 1024 / 1024,
      handles: process.getActiveResourcesInfo().length,
      connections: n,
      pending: pending.size,
      oldest
    })
    oldest > 30000 && failures.push('an operation has been pending for ' + oldest + 'ms: ' + JSON.stringify([...pending.values()][0]))
    const s = samples[samples.length - 1]
    console.log(
      s.t.toFixed(0).padStart(6) + 's heap ' + s.heap.toFixed(1) + 'MB handles ' + s.handles
      + ' connections ' + s.connections + ' pending ' + s.pending + ' oldest ' + s.oldest + 'ms'
    )
  }
}

await Promise.all([...Array(30)].map(worker).concat(faults(), sample()))

const ended = await Promise.race([sql.end({ timeout: 5 }).then(() => true), delay(15000).then(() => false)])
ended || failures.push('end() did not resolve')
await admin`drop table soak`
await admin.end()
await delay(100)

const settled = samples.slice(Math.floor(samples.length / 5))
    , fifth = Math.max(1, Math.floor(settled.length / 4))
    , mean = xs => xs.reduce((a, b) => a + b.heap, 0) / xs.length
    , early = mean(settled.slice(0, fifth))
    , late = mean(settled.slice(-fifth))
settled.length >= 4 && late > early * 1.5 + 5 && failures.push('heap grew from ' + early.toFixed(1) + 'MB to ' + late.toFixed(1) + 'MB')
Math.max(...samples.map(x => x.connections)) > 11 && failures.push('more than max connections and the listener at once')

const left = process.getActiveResourcesInfo().filter(x => x !== 'TTYWrap' && x !== 'Timeout')
left.length > 2 && failures.push('handles left after end(): ' + left.join())

console.log('\n' + Object.entries(counts).map(([k, v]) => k + ' ' + v).join(', ') + ', notifications ' + notified)
console.log(failures.length ? '⚠️ ' + failures.length + ' problems\n' + [...new Set(failures)].slice(0, 20).join('\n') : '🎉 ' + seconds + 's soak')
process.exitCode = failures.length ? 1 : 0
