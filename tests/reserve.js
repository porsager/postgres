import net from 'net'
import { t } from './test.js'
import { postgres, sql, options, delay, idle_timeout } from './setup.js'

t('Ensure reserve on connection throws proper error', async() => {
  const sql = postgres({ socket: () => { throw 'wat' }, idle_timeout })

  return [
    'wat', await sql.reserve().catch(e => e)
  ]
})

t('reserve connection', async() => {
  const reserved = await sql.reserve()

  setTimeout(() => reserved.release(), 510)

  const xs = await Promise.all([
    reserved`select 1 as x`.then(([{ x }]) => ({ time: Date.now(), x })),
    sql`select 2 as x`.then(([{ x }]) => ({ time: Date.now(), x })),
    reserved`select 3 as x`.then(([{ x }]) => ({ time: Date.now(), x }))
  ])

  if (xs[1].time - xs[2].time < 500)
    throw new Error('Wrong time')

  return [
    '123',
    xs.map(x => x.x).join('')
  ]
})

t('arrays in reserved connection', async() => {
  const reserved = await sql.reserve()
  const [{ x }] = await reserved`select array[1, 2, 3] as x`
  reserved.release()

  return [
    '123',
    x.join('')
  ]
})

t('Ensure reserve on query throws proper error', async() => {
  const sql = postgres({ idle_timeout })
  const reserved = await sql.reserve()
  const [{ x }] = await reserved`select 'wat' as x`

  return [
    'wat', x, reserved.release()
  ]
})

t('reserve with fetch_types: false on a cold pool', async() => {
  const sql = postgres({ ...options, fetch_types: false })
  const reserved = await sql.reserve()
  const [{ x }] = await reserved`select 1 as x`
  reserved.release()
  await sql.end()
  return [1, x]
})

t('end() resolves after reserve and release', async() => {
  const sql = postgres(options)
  const reserved = await sql.reserve()
  reserved.release()
  return ['ended', await sql.end().then(() => 'ended')]
})

t('end() resolves when a reserved connection is released after end was called (#1262)', async() => {
  const sql = postgres({ ...options, max: 2 })
  const reserved = await sql.reserve()
  await reserved`select 1`
  const ended = sql.end()
  await delay(10)
  reserved.release()
  return ['ended 0', await ended.then(() => 'ended') + ' ' + sql.stats.connections]
})

t('reserve queued behind a terminated connection', async() => {
  const pool = postgres(options)
  const reserved = await pool.reserve()
  const [{ pid }] = await reserved`select pg_backend_pid() as pid`
  const pending = pool.reserve()

  await sql`select pg_terminate_backend(${ pid })`

  const next = await pending
  const [{ x }] = await next`select 1 as x`
  next.release()
  await pool.end()

  return [1, x]
})

t('reserve after a terminated query', async() => {
  const pool = postgres(options)
  const reserved = await pool.reserve()
  const [{ pid }] = await reserved`select pg_backend_pid() as pid`
  const query = reserved`select pg_sleep(30)`.catch(e => e)

  while (!(await sql`select wait_event = 'PgSleep' as sleeping from pg_stat_activity where pid = ${ pid }`)[0].sleeping)
    await delay(1)

  await sql`select pg_terminate_backend(${ pid })`
  await query

  const next = await pool.reserve()
  const [{ x }] = await next`select 1 as x`
  next.release()
  await pool.end()

  return [1, x]
})

t('Reserved connection rejects queries after its backend is terminated', async() => {
  const sql = postgres({ ...options, max: 2 })
  const reserved = await sql.reserve()
  const [{ pid }] = await reserved`select pg_backend_pid() as pid`
  await sql`select pg_terminate_backend(${ pid })`
  await delay(100)
  const first = await reserved`select 1`.catch(e => e.code)
  const second = await reserved`select 2`.catch(e => e.code)
  reserved.release()
  await sql.end()
  return ['CONNECTION_CLOSED,CONNECTION_CLOSED', first + ',' + second]
})

t('Releasing a terminated reserved connection does not return it to the pool', async() => {
  const sql = postgres({ ...options, max: 1 })
  const killer = postgres(options)
  const reserved = await sql.reserve()
  const [{ pid }] = await reserved`select pg_backend_pid() as pid`
  await killer`select pg_terminate_backend(${ pid })`
  await delay(100)
  await reserved`select 1`.catch(() => {})
  reserved.release()
  const [{ x }] = await Promise.race([
    sql`select 1 as x`,
    delay(2000).then(() => [{ x: 'hung' }])
  ])
  await Promise.all([sql.end(), killer.end()])
  return [1, x]
})

t('Writing to a closed reserved connection rejects instead of crashing', async() => {
  let downstream
  const proxy = net.createServer(x => {
    downstream = x
    const upstream = net.connect(5432, '127.0.0.1')
    x.pipe(upstream).pipe(x)
    x.on('error', () => upstream.destroy())
    upstream.on('error', () => x.destroy())
  })

  await new Promise(r => proxy.listen(0, '127.0.0.1', r))

  const sql = postgres({ ...options, host: '127.0.0.1', port: proxy.address().port, max: 1 })
      , reserved = await sql.reserve()

  await reserved`select 1`
  downstream.end()
  await delay(50)

  const code = await reserved`select 1`.catch(e => e.code)
  reserved.release()
  proxy.close()

  return ['CONNECTION_CLOSED', code]
})

t('A reserved connection released while its BEGIN is still unanswered is not handed to the next query in that transaction', async() => {
  const sql = postgres({ ...options, max: 1 })
  await sql`create table test (a int)`
  const reserved = await sql.reserve()
  const begin = reserved`begin`.execute()
  const insert = reserved`insert into test values (1)`.execute()
  begin.catch(() => {})
  insert.catch(() => {})
  await new Promise(r => setTimeout(r, 0))
  reserved.release()
  const pooled = await sql`insert into test values (2)`.then(x => x.command, e => e.code)
  const leased = [await begin.then(x => x.command, e => e.code), await insert.then(x => x.command, e => e.code)]
  const rows = (await sql`select array_agg(a order by a) as a from test`)[0].a
  return ['INSERT BEGIN,INSERT [2]', pooled + ' ' + leased.join() + ' ' + JSON.stringify(rows), await sql`drop table test`, await sql.end()]
})

t('reserve and begin after end reject with CONNECTION_ENDED', async() => {
  const sql = postgres({ ...options })
  await sql`select 1`
  await sql.end()
  const codes = [await sql.reserve().then(() => 'ok', e => e.code), await sql.begin(() => 1).then(() => 'ok', e => e.code)]
  return ['CONNECTION_ENDED CONNECTION_ENDED', codes.join(' ')]
})

t('Releasing a reserved connection twice releases it once', async() => {
  const sql = postgres({ ...options, max: 1 })
  const reserved = await sql.reserve()
  reserved.release()
  reserved.release()
  const [[a], [b]] = await Promise.all([sql`select 1 as x`, sql.reserve().then(r => r`select 2 as x`.finally(r.release))])
  return ['1 2', a.x + ' ' + b.x, await sql.end()]
})
