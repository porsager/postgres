import { t } from './test.js'
import { postgres, sql, options, delay } from './setup.js'

t('unsafe describe', async() => {
  const q = 'insert into test values (1)'
  await sql`create table test(a int unique)`
  await sql.unsafe(q).describe()
  const x = await sql.unsafe(q).describe()
  return [
    q,
    x.string,
    await sql`drop table test`
  ]
})

t('Automatically creates prepared statements', async() => {
  const sql = postgres(options)
  const result = await sql`select * from pg_prepared_statements`
  return [true, result.some(x => x.name = result.statement.name)]
})

t('no_prepare: true disables prepared statements (deprecated)', async() => {
  const sql = postgres({ ...options, no_prepare: true })
  const result = await sql`select * from pg_prepared_statements`
  return [false, result.some(x => x.name = result.statement.name)]
})

t('prepare: false disables prepared statements', async() => {
  const sql = postgres({ ...options, prepare: false })
  const result = await sql`select * from pg_prepared_statements`
  return [false, result.some(x => x.name = result.statement.name)]
})

t('prepare: true enables prepared statements', async() => {
  const sql = postgres({ ...options, prepare: true })
  const result = await sql`select * from pg_prepared_statements`
  return [true, result.some(x => x.name = result.statement.name)]
})

t('prepares unsafe query when "prepare" option is true', async() => {
  const sql = postgres({ ...options, prepare: true })
  const result = await sql.unsafe('select * from pg_prepared_statements where name <> $1', ['bla'], { prepare: true })
  return [true, result.some(x => x.name = result.statement.name)]
})

t('does not prepare unsafe query by default', async() => {
  const sql = postgres({ ...options, prepare: true })
  const result = await sql.unsafe('select * from pg_prepared_statements where name <> $1', ['bla'])
  return [false, result.some(x => x.name = result.statement.name)]
})

t('Recreate prepared statements on transformAssignedExpr error', async() => {
  const insert = () => sql`insert into test (name) values (${ '1' }) returning name`
  await sql`create table test (name text)`
  await insert()
  await sql`alter table test alter column name type int using name::integer`
  return [
    1,
    (await insert())[0].name,
    await sql`drop table test`
  ]
})

t('Recreate prepared statements on RevalidateCachedQuery error', async() => {
  const select = () => sql`select name from test`
  await sql`create table test (name text)`
  await sql`insert into test values ('1')`
  await select()
  await sql`alter table test alter column name type int using name::integer`
  return [
    1,
    (await select())[0].name,
    await sql`drop table test`
  ]
})

t('Does not re-serialize json parameters when retrying on RevalidateCachedQuery error', async() => {
  const update = () => sql`update test set config = ${ sql.json({ warmup: 2100000000, ticksLimit: 5000 }) } returning *`
  await sql`create table test (id int, config jsonb)`
  await sql`insert into test values (1, '{}')`
  await update()
  await sql`alter table test add column extra int`
  await update()
  return [
    'object',
    (await sql`select jsonb_typeof(config) as type from test`)[0].type,
    await sql`drop table test`
  ]
})

t('Does not re-serialize json parameters when retrying on FetchPreparedStatement error', async() => {
  const insert = () => sql`insert into test (config) values (${ sql.json({ warmup: 2100000000 }) })`
  await sql`create table test (config jsonb)`
  await insert()
  await sql`deallocate all`
  await insert()
  return [
    'object,object',
    (await sql`select jsonb_typeof(config) as type from test`).map(x => x.type).join(),
    await sql`drop table test`
  ]
})

t('Does not re-serialize boolean parameters when retrying on RevalidateCachedQuery error', async() => {
  const update = () => sql`update test set enabled = ${ true } returning *`
  await sql`create table test (id int, enabled bool)`
  await sql`insert into test values (1, false)`
  await update()
  await sql`alter table test add column extra int`
  await update()
  return [
    true,
    (await sql`select enabled from test`)[0].enabled,
    await sql`drop table test`
  ]
})

t('Does not re-serialize boolean parameters when retrying on FetchPreparedStatement error', async() => {
  const insert = () => sql`insert into test (enabled) values (${ true })`
  await sql`create table test (enabled bool)`
  await insert()
  await sql`deallocate all`
  await insert()
  return [
    'true,true',
    (await sql`select enabled from test`).map(x => x.enabled).join(),
    await sql`drop table test`
  ]
})

t('Does not re-serialize bytea parameters when retrying on RevalidateCachedQuery error', async() => {
  const update = () => sql`update test set data = ${ Buffer.from('hello') } returning *`
  await sql`create table test (id int, data bytea)`
  await sql`insert into test values (1, null)`
  await update()
  await sql`alter table test add column extra int`
  await update()
  return [
    'hello',
    (await sql`select data from test`)[0].data.toString(),
    await sql`drop table test`
  ]
})

t('Does not re-serialize bytea parameters when retrying on FetchPreparedStatement error', async() => {
  const insert = () => sql`insert into test (data) values (${ Buffer.from('hello') })`
  await sql`create table test (data bytea)`
  await insert()
  await sql`deallocate all`
  await insert()
  return [
    'hello,hello',
    (await sql`select data from test`).map(x => x.data.toString()).join(),
    await sql`drop table test`
  ]
})

t('Properly throws routine error on not prepared statements', async() => {
  await sql`create table x (x text[])`
  const { routine } = await sql.unsafe(`
    insert into x(x) values (('a', 'b'))
  `).catch(e => e)

  return ['transformAssignedExpr', routine, await sql`drop table x`]
})

t('Properly throws routine error on not prepared statements using file', async() => {
  const { routine } = await sql.unsafe(`
    create table x (x text[]);
    insert into x(x) values (('a', 'b'));
  `, { prepare: true }).catch(e => e)

  return ['transformAssignedExpr', routine]
})

t('Describe', async() => {
  const type = (await sql`select ${ 1 }::int as x`.describe()).types[0]
  return [23, type]
})

t('Describe a statement', async() => {
  await sql`create table tester (name text, age int)`
  const r = await sql`select name, age from tester where name like $1 and age > $2`.describe()
  return [
    '25,23/name:25,age:23',
    `${ r.types.join(',') }/${ r.columns.map(c => `${c.name}:${c.type}`).join(',') }`,
    await sql`drop table tester`
  ]
})

t('Describe a statement without parameters', async() => {
  await sql`create table tester (name text, age int)`
  const r = await sql`select name, age from tester`.describe()
  return [
    '0,2',
    `${ r.types.length },${ r.columns.length }`,
    await sql`drop table tester`
  ]
})

t('Describe a statement without columns', async() => {
  await sql`create table tester (name text, age int)`
  const r = await sql`insert into tester (name, age) values ($1, $2)`.describe()
  return [
    '2,0',
    `${ r.types.length },${ r.columns.length }`,
    await sql`drop table tester`
  ]
})

t('Fails a stale prepared statement once when a query is piped behind it', async() => {
  const sql = postgres(options)
  const piped = () => Promise.all([sql`select 1 as x`, sql`select 2 as x`])
  await piped()
  await sql`deallocate all`
  const error = await piped().catch(e => e)
  return [
    '26000,12',
    error.code + ',' + (await piped()).map(([{ x }]) => x).join(''),
    await sql.end()
  ]
})

t('Holds the connection while retrying a prepared statement', async() => {
  let builds = 0
    , other
  const sql = postgres({
    ...options,
    debug: (_, x) => x === 'select * from test where id = $1' && ++builds === 3 && (other = get(2).execute())
  })
  const read = id => sql`select * from test where id = ${ id }`
  const get = id => sql`select id, name, null::int as extra from test where id = ${ id }`
  await sql`create table test (id int, name text)`
  await sql`insert into test values (1, 'a'), (2, 'b')`
  await read(1)
  await get(2)
  await sql`alter table test add column extra int`
  const [x] = await read(1)
  const [y] = await other
  return [
    '1a2b',
    x.id + x.name + y.id + y.name,
    await sql`drop table test`,
    await sql.end()
  ]
})

t('Answers two stale prepared statements piped together', async() => {
  const sql = postgres(options)
  const read = id => sql`select * from test where id = ${ id }`
  await sql`create table test (id int, name text)`
  await sql`insert into test values (1, 'a'), (2, 'b')`
  await read(1)
  await sql`alter table test add column extra int`
  const [error, [x]] = await Promise.all([read(1).catch(e => e), read(2)])
  const [y] = await sql`select 3 as id, 'c' as name`
  const [z] = await read(1)
  return [
    '0A000,2b,3c,1a',
    [error.code, x.id + x.name, y.id + y.name, z.id + z.name].join(),
    await sql`drop table test`,
    await sql.end()
  ]
})

t('A stale prepared statement retried with a transaction queued behind it stays outside the transaction', async() => {
  const sql = postgres(options)
  const insert = x => sql`insert into test (name) values (${ x }) returning *`
  await sql`create table test (id serial primary key, name text)`
  await insert('a')
  await sql`alter table test add column extra int`
  await Promise.all([
    insert('b'),
    sql.begin(async sql => {
      await sql`select 1`
      throw new Error('rollback')
    }).catch(() => null)
  ])
  return [
    'a,b',
    (await sql`select name from test order by id`).map(x => x.name).join(),
    await sql`drop table test`,
    await sql.end()
  ]
})

t('Does not give a stale prepared statement the answer of a statement piped behind it', async() => {
  const sql = postgres(options)
  const select = () => sql`select * from test order by id`
  const get = id => sql`select name from test where id = ${ id }`
  await sql`create table test (id int, name text)`
  await sql`insert into test values (1, 'a'), (2, 'b')`
  await select()
  await sql`alter table test add column extra int`
  const [error, [x]] = await Promise.all([select().catch(e => e), get(2)])
  const [y] = await get(2)
  return [
    '0A000,b,b',
    [error.code, x.name, y.name].join(),
    await sql`drop table test`,
    await sql.end()
  ]
})

t('Does not reorder writes on a reserved connection when retrying a stale prepared statement', async() => {
  const sql = postgres(options)
  const reserved = await sql.reserve()
  await reserved`create table test (id int primary key, name text)`
  await reserved`insert into test values (1, 'a')`
  await reserved`delete from test`
  await reserved`deallocate all`
  const [error] = await Promise.all([
    reserved`insert into test values (1, 'a')`.catch(e => e),
    reserved`update test set name = 'b' where id = 1`
  ])
  reserved.release()
  return [
    '26000,',
    error.code + ',' + (await sql`select name from test`).map(x => x.name).join(),
    await sql`drop table test`,
    await sql.end()
  ]
})

t('Does not retry a cancelled stale prepared statement', async() => {
  const sql = postgres(options)
  await sql`select 1 as x`
  await sql`deallocate all`
  sql`select pg_sleep(0.5)`.execute()
  const query = sql`select 1 as x`.execute()
  setTimeout(() => query.cancel(), 100)
  return ['26000', (await query.catch(e => e)).code, await sql.end()]
})

t('Stale prepared statements in a transaction returning an array of queries reject and release the connection', async() => {
  const other = postgres(options)
  await sql`create table test (id int, a int)`
  await sql`insert into test values (1, 1)`
  await other`select * from test where id = ${ 1 }`
  await other`select id from test where id = ${ 1 } and a > ${ 0 }`
  await sql`alter table test add column b int`
  const error = await other.begin(sql => [
    sql`select * from test where id = ${ 1 }`,
    sql`select id from test where id = ${ 1 } and a > ${ 0 }`
  ]).catch(e => e.code)
  const [row] = await other`select * from test where id = ${ 1 }`
  await sql`drop table test`
  await other.end()
  return ['0A000,true', [error, 'b' in row].join()]
})

t('Stale prepared statement is not retried after the transaction it was pipelined in ends', async() => {
  const other = postgres(options)
  await sql`create table test (id int, a int)`
  await sql`insert into test values (1, 1)`
  await other`update test set a = a + ${ 1 } where id = 1 returning *`
  await sql`alter table test add column b int`
  const reserved = await other.reserve()
  const results = await Promise.all([
    reserved`begin`,
    reserved`insert into test values (2, 2)`,
    reserved`update test set a = a + ${ 1 } where id = 1 returning *`,
    reserved`commit`
  ].map(x => x.then(x => x.command, e => e.code)))
  reserved.release()
  const rows = (await sql`select id, a from test order by id`).map(x => x.id + ':' + x.a)
  await sql`drop table test`
  await other.end()
  return ['BEGIN,INSERT,0A000,ROLLBACK,1:2', [...results, ...rows].join()]
})

t('prepare: false describes every time, so a changed column type is seen at once, as in v3', async() => {
  const sql = postgres({ ...options, prepare: false, max: 1 })
  const insert = x => sql`insert into test values (${ x }) returning x::text as x`
  await sql`create table test (x boolean)`
  const [a] = await insert(true)
  await sql`alter table test alter column x type int using x::int`
  const [b] = await insert(1)
  await sql`alter table test alter column x type json using to_json(x)`
  const [c] = await insert({ a: 1 })
  return ['true 1 {"a":1}', [a.x, b.x, c.x].join(' '), await sql`drop table test`, await sql.end()]
})

t('A prepared statement that a changed column type no longer fits is prepared again and the query re-run', async() => {
  const sql = postgres({ ...options, max: 1 })
  const insert = x => sql`insert into test values (${ x }) returning x::text as x`
  await sql`create table test (x int)`
  await insert(1)
  await sql`alter table test alter column x type uuid using null`
  const id = '6f1c2c43-6f6b-4a40-9a39-2d8f4a1f3b11'
  const rows = []
  for (let i = 0; i < 3; i++)
    rows.push((await insert(id))[0].x)
  return [[id, id, id].join(), rows.join(), await sql`drop table test`, await sql.end()]
})

t('A value the learned types cannot write is written for a fresh description', async() => {
  const sql = postgres({ ...options, max: 1 })
  const insert = x => sql`insert into test values (${ x }) returning x::text as x`
  await sql`create table test (x bytea)`
  await insert(Buffer.from('hi'))
  await sql`alter table test alter column x type int using null`
  const [{ x }] = await insert(7)
  return ['7', x, await sql`drop table test`, await sql.end()]
})

t('A prepared statement made on a new connection has the types the pool writes values for', async() => {
  const sql = postgres({ ...options, max: 1 })
  const insert = x => sql`insert into test values (${ x }) returning x::text as x`
  await sql`create table test (x text)`
  await insert('123')
  await sql.close()
  await sql`alter table test alter column x type json using null`
  const [{ x }] = await insert('123')
  return ['"123"', x, await sql`drop table test`, await sql.end()]
})

t('A query waiting on another query\'s description of the same statement does not get that query\'s error', async() => {
  const sql = postgres({ ...options, max: 4 })
  await Promise.all([1, 2, 3].map(() => sql`select pg_sleep(0.02)`))
  const out = []
  await sql.begin(async tx => {
    await tx`select 1/0`.catch(() => {})
    const a = tx`select ${ 1 }::int as shared_describe_shape`.then(() => 'ok', e => e.code)
    for (let i = 0; i < 5; i++)
      await Promise.resolve()
    const b = sql`select ${ 2 }::int as shared_describe_shape`.then(x => x[0].shared_describe_shape, e => e.code)
    out.push(...await Promise.all([a, b]))
  }).catch(() => {})
  return ['25P02,2', out.join(), await sql.end()]
})

t('An invalid value for a prepared statement keeps the statement and leaves nothing behind on the server', async() => {
  const sql = postgres({ ...options, max: 4 })
  await sql`create table test (id uuid)`
  const q = id => sql`select * from test where id = ${ id }`
      , zero = '00000000-0000-0000-0000-000000000000'
  const counts = async() => {
    const reserved = await Promise.all([1, 2, 3, 4].map(() => sql.reserve()))
    const n = await Promise.all(reserved.map(r => r`select count(*)::int as n from pg_prepared_statements`.then(x => x[0].n)))
    reserved.forEach(r => r.release())
    return Math.max(...n)
  }
  await Promise.all(Array.from({ length: 40 }, () => q(zero)))
  const before = await counts()
  const codes = new Set()
  for (let i = 0; i < 50; i++)
    await Promise.all([q('not-a-uuid').catch(e => codes.add(e.code)), q(zero), q(zero), q(zero)])
  const after = await counts()
  return ['22P02 true', [...codes].join() + ' ' + (after <= before + 1), await sql`drop table test`, await sql.end()]
})

t('A connection that prepares a statement for the first time reads the columns it has now, not those another connection learned', async() => {
  const sql = postgres({ ...options, max: 2 })
  await sql`create table test (id int, v int)`
  await sql`insert into test values (1, 10)`
  const reserved = await sql.reserve()
  const query = sql => sql`select * from test where id = ${ 1 }`
  const before = await query(reserved)
  await sql`alter table test alter column v type text using '0' || v::text`
  await sql`alter table test add column w text default 'new'`
  const after = await query(sql)
  reserved.release()
  return [
    '[{"id":1,"v":10}] [{"id":1,"v":"010","w":"new"}]',
    JSON.stringify(before) + ' ' + JSON.stringify(after),
    await sql`drop table test`,
    await sql.end()
  ]
})

t('A connection that prepares a statement for the first time writes values for the parameter types it has now', async() => {
  const sql = postgres({ ...options, max: 2 })
  await sql`create table test (id int, v boolean)`
  const reserved = await sql.reserve()
  const insert = (sql, id, v) => sql`insert into test values (${ id }, ${ v })`
  await insert(reserved, 1, 'false')
  await sql`alter table test alter column v type text`
  await insert(sql, 2, 'yes')
  await insert(reserved, 3, 'no')
  reserved.release()
  return [
    'false,yes,no',
    (await sql`select v from test order by id`).map(x => x.v).join(),
    await sql`drop table test`,
    await sql.end()
  ]
})

t('The same query in schemas of different shape gets the rows of its own schema on every connection', async() => {
  const sql = postgres({ ...options, max: 2 })
  await sql.unsafe(`
    create schema tenant_a; create schema tenant_b;
    create table tenant_a.t (id int, val int); insert into tenant_a.t values (1, 42);
    create table tenant_b.t (id int, label text); insert into tenant_b.t values (1, 'hello')
  `)
  const tenant = (schema, hold) => sql.begin(async sql => {
    await sql`select set_config('search_path', ${ schema }, true)`
    const [row] = await sql`select * from t where id = ${ 1 }`
    await delay(hold)
    return JSON.stringify(row)
  })
  const results = []
  for (let i = 0; i < 5; i++)
    results.push(...await Promise.all([tenant('tenant_a', 20), tenant('tenant_b', 10)]))
  const counts = results.reduce((acc, x) => (acc[x] = (acc[x] || 0) + 1, acc), {})
  return [
    '{"{\\"id\\":1,\\"val\\":42}":5,"{\\"id\\":1,\\"label\\":\\"hello\\"}":5}',
    JSON.stringify(counts),
    await sql.unsafe('drop schema tenant_a cascade; drop schema tenant_b cascade'),
    await sql.end()
  ]
})

t('A late 26000 does not make the connection forget a statement prepared again behind it', async() => {
  const sql = postgres({ ...options, max: 1 })
  const query = () => sql`select ${ 1 }::int as x`
  const code = x => x.then(() => 'ok', e => e.code)
  await query()
  const deallocated = sql.unsafe('deallocate all').execute()
  let third
  const first = query().catch(e => (third = code(query()), e.code))
  const sleep = sql.unsafe('select pg_sleep(0.1)').execute()
  const second = query().execute()
  const before = [await code(deallocated), await first, await code(sleep), await code(second), await third]
  const after = []
  for (let i = 0; i < 3; i++)
    after.push(await code(query()))
  return ['ok,26000,ok,26000,ok ok,ok,ok', before.join() + ' ' + after.join(), await sql.end()]
})

t('Stale statements pipelined on the pool are all run again', async() => {
  const sql = postgres({ ...options, max: 2 })
  await sql`create table test (id int, v int)`
  await sql`insert into test values (1, 10)`
  const query = () => sql`select v from test where id = ${ 1 }`
  await Promise.all([query(), query(), query(), query()])
  await sql`alter table test alter column v type text`
  const results = await Promise.all([...Array(6)].map(() => query().then(x => x[0].v, e => e.code)))
  return ['10,10,10,10,10,10', results.join(), await sql`drop table test`, await sql.end()]
})

t('A statement name the server already has on a connection is prepared under a new name (#960)', { timeout: 5 }, async() => {
  const sql = postgres({ ...options, max: 2, prepare: true })
  const one = await sql.reserve()
  const two = await sql.reserve()
  const first = await one`select ${ 1 }::int as x`
  await two.unsafe('prepare "' + first.statement.name + '" as select $1::int as x')
  const [{ x }] = await two`select ${ 3 }::int as x`
  const [{ x: y }] = await two`select ${ 4 }::int as x`
  one.release()
  two.release()
  return ['3 4', x + ' ' + y, await sql.end()]
})

t('Statements past the connection and pool limits are closed and prepared again when used', { timeout: 30 }, async() => {
  const sql = postgres({ ...options, max: 1, prepare: true })
      , run = i => sql.unsafe('select $1::int + ' + i + ' as x', [1], { prepare: true })
  for (let i = 0; i < 2100; i += 100)
    await Promise.all(Array.from({ length: 100 }, (_, j) => run(i + j)))
  const [{ n }] = await sql`select count(*)::int as n from pg_prepared_statements`
      , [{ x }] = await run(0)
  return ['true 1', (n <= 1001) + ' ' + x, await sql.end()]
})
