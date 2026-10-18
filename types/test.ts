import dc from 'node:diagnostics_channel'
import postgres, { type Sql, type TransactionSql, type Row, type PendingQuery, type ReplicationEvent, type QueryTrace, type PoolEvent } from './index.js'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
const expect = <T extends true>() => {}

interface User { id: number, name: string, age: number | null }

const sql = postgres({
  host: ['a', 'b'],
  port: 5432,
  ssl: 'require',
  sslnegotiation: 'direct',
  max: 10,
  max_pipeline: 50,
  idle_timeout: 20,
  max_lifetime: () => 60,
  infer: false,
  onnotice: false,
  slot: 'my_slot',
  onread: false,
  password: async() => 'secret',
  transform: postgres.camel,
  connection: { application_name: 'test', statement_timeout: 1000 },
  types: { bigint: postgres.BigInt }
})

postgres('postgres://user@host/db', { ssl: { rejectUnauthorized: false } })
postgres()

// @ts-expect-error not an sslnegotiation
postgres({ sslnegotiation: 'eventually' })
// @ts-expect-error not an ssl mode
postgres({ ssl: 'sometimes' })

async function queries() {
  const users = await sql<User[]>`select * from users where id = ${ 1 } and name = ${ 'a' }`
  expect<Equal<typeof users[number], User>>()
  users.count
  users.command
  users.columns[0].name
  for (const user of users)
    expect<Equal<typeof user, User>>()

  const [first] = await sql<[User?]>`select * from users limit 1`
  expect<Equal<typeof first, User | undefined>>()

  const rows = await sql`select 1 as x`
  expect<Equal<typeof rows[number], Row>>()

  const big = await sql`select ${ sql.typed.bigint(10n) } as x`
  big[0].x

  const q = sql`select ${ new Date() } as d`
  const text: string = q.text
  const parameters: any[] = q.parameters
  expect<Equal<typeof q, PendingQuery<Row[]>>>()

  await sql`insert into users ${ sql({ name: 'a', age: 1 }, 'name', 'age') }`
  await sql`insert into users ${ sql([{ name: 'a', age: 1 }, { name: 'b', age: 2 }]) }`
  await sql`update users set ${ sql({ name: 'b' }) } where id = 1`
  await sql`select * from ${ sql('users') } where id in ${ sql([1, 2, 3]) }`
  await sql`select * from users ${ true ? sql`where id = ${ 1 }` : sql`` }`
  await sql`select ${ sql.json({ a: [1, 2] }) }::json`
  await sql`select ${ [1, 2, 3] }::int[]`

  await sql.unsafe('select 1', [], { prepare: true })
  await sql.unsafe<User[]>('select * from users where id = $1', [1])
  await sql.unsafe('select 1; select 2', { simple: true })

  const values = await sql`select 1 as x`.values()
  expect<Equal<typeof values[number], any[]>>()
  const raw = await sql`select 1 as x`.raw()
  raw[0][0]

  const statement = await sql`select ${ 1 }::int as x`.describe()
  statement.types.map(x => x + 1)

  await sql<User[]>`select * from users`.forEach(user => {
    expect<Equal<typeof user, User>>()
  })

  for await (const batch of sql<User[]>`select * from users`.cursor(10))
    expect<Equal<typeof batch, User[]>>()

  await sql<User[]>`select * from users`.cursor(10, async batch => {
    expect<Equal<typeof batch, User[]>>()
    return sql.CLOSE
  })

  const pending = sql`select pg_sleep(1)`.execute()
  await pending.cancel()

  const readable = await sql`copy users to stdout`.readable()
  readable.pipe(process.stdout)
  const writable = await sql`copy users from stdin`.writable()
  writable.end('1\ta\n')

  // @ts-expect-error a helper is not a query
  await sql('users')
  // @ts-expect-error removed in v4
  sql.array([1, 2]).value
}

async function transactions() {
  const [a, b] = await sql.begin(sql => [
    sql`select 1 as x`,
    sql<User[]>`select * from users`
  ])
  expect<Equal<typeof a[number], Row>>()
  expect<Equal<typeof b[number], User>>()

  const result = await sql.begin('read write', async sql => {
    const tx: TransactionSql<{ bigint: bigint }> = sql
    await sql.savepoint(async sql => sql`select 1`)
    await sql.savepoint('named', sql => sql`select 1`)
    expect<Equal<ReturnType<typeof sql.prepare>, string>>()
    sql.prepare('tx1')
    expect<Equal<ReturnType<typeof sql.rollback>, Promise<void>>>()
    await sql.savepoint(sql => sql.rollback())
    return 42
  })
  expect<Equal<typeof result, number>>()

  const reserved = await sql.reserve()
  await reserved`select 1`
  reserved.release()
  // @ts-expect-error a reserved connection cannot end the pool
  reserved.end()
}

async function rest() {
  const listened = await sql.listen('news', payload => {
    expect<Equal<typeof payload, string>>()
  })
  expect<Equal<keyof typeof listened, 'state' | 'unlisten'>>()
  const { unlisten } = listened
  await unlisten()
  await sql.notify('news', 'hi')

  const { unsubscribe } = await sql.subscribe('*:users', async(row, info, event) => {
    expect<Equal<typeof info, ReplicationEvent>>()
    info.lsn
    info.time
    if (info.command === 'update')
      info.old
    if (info.command === 'truncate')
      info.restartIdentity
  }, () => {}, error => error.message)
  unsubscribe()

  const lo = await sql.largeObject()
  await lo.close()

  sql.stats.waiting
  sql.options.max
  sql.parameters.TimeZone

  await sql.close()
  await sql.end({ timeout: 5 })

  try {
    await sql`select`
  } catch (error) {
    if (error instanceof postgres.PostgresError)
      error.code
  }
}

function pass(sql: Sql) {
  return sql`select 1`
}
pass(postgres())

const named: string = postgres.toCamel('a_b')
postgres.fromCamel(named)

dc.subscribe('tracing:postgres:query:asyncEnd', message => {
  const x = message as QueryTrace
  const ms: number | null = x.complete && x.complete - x.queued
  x.command?.toLowerCase()
  ms
})
dc.subscribe('postgres:pool', message => (message as PoolEvent).stats.waiting)

queries
transactions
rest
