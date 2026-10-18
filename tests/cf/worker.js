import dc from 'node:diagnostics_channel'
import postgres from '../../src/cf.js'

const base = {
  host: '127.0.0.1',
  port: 5432,
  database: 'postgres_js_test',
  user: 'postgres_js_test',
  max: 4,
  idle_timeout: 1
}

const configs = {
  trust: base,
  md5: { ...base, user: 'postgres_js_test_md5', pass: 'postgres_js_test_md5' },
  scram: { ...base, user: 'postgres_js_test_scram', pass: 'postgres_js_test_scram' },
  tls: { ...base, host: 'localhost', ssl: 'require' },
  scramtls: { ...base, host: 'localhost', ssl: 'require', user: 'postgres_js_test_scram', pass: 'postgres_js_test_scram' },
  direct: { ...base, ssl: 'require', sslnegotiation: 'direct' }
}

const checks = {
  select: async sql => (await sql`select 1 as x`)[0].x === 1,
  async params(sql) {
    const [x] = await sql`
      select
        (${ 5 }::int + 1)::text || ${ 'a' } as y,
        ${ new Date(0) }::timestamptz as d,
        ${ [1, 2] }::int[] as a,
        ${ sql.json({ a: 1 }) }::json as j
    `
    return x.y === '6a' && x.d.getTime() === 0 && x.a[1] === 2 && x.j.a === 1
  },
  async pipeline(sql) {
    const xs = await Promise.all([...Array(200)].map((_, i) => sql`select ${ i }::int as i`))
    return xs.every((x, i) => x[0].i === i)
  },
  async large(sql) {
    const text = 'x'.repeat(300000)
    const [x] = await sql`select length(${ text }) as n`
    const [y] = await sql.begin(sql => sql`select length(${ text }) as n`)
    return x.n === 300000 && y.n === 300000
  },
  rows: async sql => (await sql`select generate_series(1, 100000) as n, md5(random()::text) as m`).length === 100000,
  async begin(sql) {
    const [x] = await sql.begin(async sql => {
      await sql`create temp table t (x int)`
      await sql`insert into t values (1)`
      return sql`select count(*)::int as c from t`
    })
    return x.c === 1
  },
  async cursor(sql) {
    let n = 0
    await sql`select generate_series(1, 1000) as x`.cursor(100, rows => n += rows.length)
    return n === 1000
  },
  async copy(sql) {
    let bytes = 0
    for await (const x of await sql`copy (select generate_series(1, 10000)) to stdout`.readable())
      bytes += x.length
    return bytes === 48894
  },
  async listen(sql) {
    let got
    await sql.listen('cf', x => got = x)
    await sql.notify('cf', 'hi')
    await new Promise(r => setTimeout(r, 200))
    return got === 'hi'
  },
  error: async sql => (await sql`select wat`.catch(e => e.code)) === '42703',
  async tracing(sql) {
    const seen = []
        , channel = dc.tracingChannel('postgres:query')
        , handlers = { start() {}, end() {}, asyncStart() {}, asyncEnd: x => seen.push(x.command + ':' + x.query), error() {} }
    channel.subscribe(handlers)
    try {
      await sql`select ${ 1 }::int as x`
    } finally {
      channel.unsubscribe(handlers)
    }
    return seen.join() === 'SELECT:select $1::int as x'
  },
  async prepared(sql) {
    const xs = await Promise.all([...Array(50)].map((_, i) => sql`select ${ i }::int as i, ${ 'x' + i } as s`))
    return xs.every((x, i) => x[0].i === i && x[0].s === 'x' + i)
  },
  async unnamed(sql) {
    const xs = await Promise.all([...Array(20)].map((_, i) => sql.unsafe('select $1::int as i', [i])))
    return xs.every((x, i) => x[0].i === i)
  },
  async cancel(sql) {
    const q = sql`select pg_sleep(2)`
    setTimeout(() => q.cancel(), 200)
    return (await q.catch(e => e.code)) === '57014'
  }
}

const everywhere = ['select', 'params', 'rows', 'copy']

async function check(o, fn) {
  const sql = typeof o === 'string' ? postgres(o, { max: 4, idle_timeout: 1 }) : postgres(o)
      , start = Date.now()
  try {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))
    return await Promise.race([fn(sql), timeout]) + ' ' + (Date.now() - start) + 'ms'
  } catch (e) {
    return 'ERROR ' + (e.code || '') + ' ' + (e.stack || e.message || e).toString().split('\n').slice(0, 4).join(' | ')
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {})
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
        , only = url.searchParams.get('only')
        , out = {}

    if (env.TOKEN && request.headers.get('x-token') !== env.TOKEN)
      return new Response('Forbidden', { status: 403 })

    if (url.pathname === '/hyperdrive') {
      if (!env.HYPERDRIVE)
        return Response.json({ failed: 1, error: 'No HYPERDRIVE binding' }, { status: 500 })

      for (const [name, fn] of Object.entries(checks).filter(([x]) => x !== 'listen' && (!only || x.startsWith(only))))
        out['hyperdrive ' + name] = await check(env.HYPERDRIVE.connectionString, fn)
      return report(out)
    }

    for (const [name, o] of Object.entries(configs).filter(([name]) => !only || name.startsWith(only))) {
      for (const [name2, fn] of Object.entries(checks).filter(([x]) => name === 'trust' || everywhere.includes(x)))
        out[name + ' ' + name2] = await check(o, fn)
    }
    return report(out)
  }
}

function report(out) {
  const failed = Object.entries(out).filter(([k, v]) =>
    k.startsWith('direct') ? !v.includes('SSL_NEGOTIATION_NOT_SUPPORTED') : !v.startsWith('true')
  ).length
  return Response.json({ failed, ...out }, { status: failed ? 500 : 200 })
}
