import net from 'net'
import { t } from './test.js'
import { postgres, sql, options, delay } from './setup.js'

const count = async sql => (await sql`select count(*)::int as n from test`)[0].n

t('sql.batch gives the results of its queries in order', async() => {
  await sql`create table test (id int primary key, v text)`
  const [a, b, c] = await sql.batch([
    sql`insert into test values (${ 1 }, ${ 'a' })`,
    sql`insert into test values (${ 2 }, ${ 'b' }) returning *`,
    sql`select v from test order by id`
  ])
  return [
    'INSERT 1 | INSERT b | SELECT a,b',
    [a.command + ' ' + a.count, b.command + ' ' + b[0].v, c.command + ' ' + c.map(x => x.v).join()].join(' | '),
    await sql`drop table test`
  ]
})

t('sql.batch of an empty array gives an empty array', async() =>
  ['[]', JSON.stringify(await sql.batch([]))]
)

t('sql.batch commits nothing when one of its queries fails', async() => {
  await sql`create table test (id int primary key)`
  const error = await sql.batch([
    sql`insert into test values (${ 1 })`,
    sql`insert into test values (${ 1 })`,
    sql`insert into test values (${ 2 })`
  ]).catch(e => e)
  return ['23505 1 0', error.code + ' ' + error.index + ' ' + await count(sql), await sql`drop table test`]
})

t('sql.batch rejects each of its queries, the ones after the failing one as skipped', async() => {
  await sql`create table test (id int primary key)`
  const queries = [sql`insert into test values (${ 1 })`, sql`insert into test values (${ 1 })`, sql`select ${ 'x' }::text as x`]
  await sql.batch(queries).catch(() => null)
  const errors = await Promise.all(queries.map(q => q.catch(e => [e.code, e.index, !!e.skipped].join())))
  return ['23505,1,true 23505,1,false 23505,1,true', errors.join(' '), await sql`drop table test`]
})

t('sql.batch rejects with the index of a query that cannot be built and runs none of them', async() => {
  await sql`create table test (id int)`
  const error = await sql.batch([sql`insert into test values (${ 1 })`, sql`select ${ undefined } as x`]).catch(e => e)
  return ['UNDEFINED_VALUE 1 0', error.code + ' ' + error.index + ' ' + await count(sql), await sql`drop table test`]
})

t('sql.batch rolls back the queries before one whose value cannot be written', async() => {
  const sql = postgres({ ...options, max: 1, types: { bad: { to: 25, from: [], serialize: x => { throw new Error('no ' + x) } } } })
  await sql`create table test (id int, v text)`
  const error = await sql.batch([
    sql`insert into test (id) values (${ 1 })`,
    sql`insert into test values (${ 2 }, ${ sql.typed('x', 25) })`,
    sql`insert into test (id) values (${ 3 })`
  ]).catch(e => e)
  return ['no x 1 0 1', [error.message, error.index, await count(sql), (await sql`select 1 as x`)[0].x].join(' '), await sql`drop table test`, await sql.end()]
})

t('sql.batch keeps working after a statement in it fails to parse', async() => {
  const error = await sql.batch([sql`select ${ 1 }::int as x`, sql`selec ${ 1 }`, sql`select 2 as x`]).catch(e => e)
  const [[a], [b]] = await sql.batch([sql`select ${ 1 }::int as x`, sql`select 2 as x`])
  return ['42601 1 1 2', [error.code, error.index, a.x, b.x].join(' ')]
})

t('sql.batch in a transaction runs in that transaction', async() => {
  await sql`create table test (id int)`
  const error = await sql.begin(async sql => {
    await sql.batch([sql`insert into test values (${ 1 })`, sql`insert into test values (${ 2 })`])
    await sql`insert into test values (${ 'x' }::int)`
  }).catch(e => e.code)
  const [a, b] = await sql.begin(sql => sql.batch([sql`insert into test values (${ 3 })`, sql`select count(*)::int as n from test`]))
  return ['22P02 1 1', [error, a.count, b[0].n].join(' '), await sql`drop table test`]
})

t('sql.batch on a reserved connection', async() => {
  const reserved = await sql.reserve()
  const [[a], [b]] = await reserved.batch([reserved`select pg_backend_pid() as pid`, reserved`select pg_backend_pid() as pid`])
  reserved.release()
  return [true, a.pid === b.pid]
})

t('Queries pipelined around a batch on the same connection keep their own results and errors', async() => {
  const sql = postgres({ ...options, max: 1 })
  const before = sql`select ${ 'before' }::text as x`
      , failing = sql.batch([sql`select ${ 1 }::int as x`, sql`select 1/${ 0 }::int as x`])
      , after = sql`select ${ 'after' }::text as x`
      , ok = sql.batch([sql`select ${ 'a' }::text as x`, sql`select ${ 'b' }::text as x`])
  const results = await Promise.all([before, failing.catch(e => e.code + ' ' + e.index), after, ok])
  return [
    'before 22012 1 after a,b',
    [results[0][0].x, results[1], results[2][0].x, results[3].map(r => r[0].x).join()].join(' '),
    await sql.end()
  ]
})

t('sql.batch sends its queries with one Sync in one write once prepared', async() => {
  let writes = 0
    , syncs = 0
  const server = net.createServer(client => {
    const upstream = net.connect(options.port || 5432, options.host || 'localhost')
    client.on('data', x => {
      writes++
      for (let i = 0; i < x.length; i += 1 + x.readInt32BE(i + 1))
        x[i] === 83 && syncs++
      upstream.write(x)
    })
    upstream.on('data', x => client.write(x))
    client.on('close', () => upstream.destroy())
    upstream.on('close', () => client.destroy())
  })
  await new Promise(r => server.listen(0, 'localhost', r))
  const sql = postgres({ ...options, host: 'localhost', port: server.address().port, max: 1 })
  const run = () => sql.batch([sql`select ${ 1 }::int as x`, sql`select ${ 2 }::int as y`, sql`select ${ 3 }::int as z`])
  await run()
  writes = syncs = 0
  const [[a], [b], [c]] = await run()
  const counted = [writes, syncs]
  await sql.end()
  server.close()
  return ['1 1 1 2 3', [...counted, a.x, b.y, c.z].join(' ')]
})

t('sql.batch rejects things that are not queries, and queries that already ran', async() => {
  const ran = sql`select 1`
  await ran
  const errors = []
  for (const x of ['select 1', [1], [ran]]) {
    try {
      sql.batch(x)
    } catch (e) {
      errors.push(e.code)
    }
  }
  return ['BATCH_NOT_ARRAY,BATCH_NOT_QUERY,BATCH_EXECUTED', errors.join()]
})

t('Cancelling a batch rejects it and leaves the connection usable', async() => {
  const sql = postgres({ ...options, max: 1 })
  const batch = sql.batch([sql`select pg_sleep(1)`, sql`select ${ 1 }::int as x`])
  const rejected = batch.catch(e => e.code)
  await delay(100)
  await batch.cancel()
  const code = await rejected
  return ['57014 1', code + ' ' + (await sql`select 1 as x`)[0].x, await sql.end()]
})
