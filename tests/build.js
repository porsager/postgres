import { t } from './test.js'
import { postgres, sql, options, delay, rel } from './setup.js'

t('Escapes', async() => {
  return ['hej"hej', Object.keys((await sql`select 1 as ${ sql('hej"hej') }`)[0])[0]]
})

t('sql file', async() =>
  [1, (await sql.file(rel('select.sql')))[0].x]
)

t('sql file has forEach', async() => {
  let result
  await sql
    .file(rel('select.sql'), { cache: false })
    .forEach(({ x }) => result = x)

  return [1, result]
})

t('sql file cached', async() => {
  await sql.file(rel('select.sql'))
  await delay(20)

  return [1, (await sql.file(rel('select.sql')))[0].x]
})

t('Parameters in file', async() => {
  const result = await sql.file(
    rel('select-param.sql'),
    ['hello']
  )
  return ['hello', result[0].x]
})

t('unsafe', async() => {
  await sql`create table test (x int)`
  return [1, (await sql.unsafe('insert into test values ($1) returning *', [1]))[0].x, await sql`drop table test`]
})

t('unsafe simple', async() => {
  return [1, (await sql.unsafe('select 1 as x'))[0].x]
})

t('unsafe simple includes columns', async() => {
  return ['x', (await sql.unsafe('select 1 as x').values()).columns[0].name]
})

t('simple query using unsafe with multiple statements', async() => {
  return [
    '1,2',
    (await sql.unsafe('select 1 as x;select 2 as x')).map(x => x[0].x).join()
  ]
})

t('simple query using simple() with multiple statements', async() => {
  return [
    '1,2',
    (await sql`select 1 as x;select 2 as x`.simple()).map(x => x[0].x).join()
  ]
})

t('big query body', async() => {
  await sql`create table test (x int)`
  return [50000, (await sql`insert into test ${
    sql([...Array(50000).keys()].map(x => ({ x })))
  }`).count, await sql`drop table test`]
})

t('let postgres do implicit cast of unknown types', async() => {
  await sql`create table test (x timestamp with time zone)`
  const [{ x }] = await sql`insert into test values (${ new Date().toISOString() }) returning *`
  return [true, x instanceof Date, await sql`drop table test`]
})

t('only allows one statement', async() =>
  ['42601', await sql`select 1; select 2`.catch(e => e.code)]
)

t('dynamic table name', async() => {
  await sql`create table test(a int)`
  return [
    0, (await sql`select * from ${ sql('test') }`).count,
    await sql`drop table test`
  ]
})

t('dynamic schema name', async() => {
  await sql`create table test(a int)`
  return [
    0, (await sql`select * from ${ sql('public') }.test`).count,
    await sql`drop table test`
  ]
})

t('dynamic schema and table name', async() => {
  await sql`create table test(a int)`
  return [
    0, (await sql`select * from ${ sql('public.test') }`).count,
    await sql`drop table test`
  ]
})

t('dynamic column name', async() => {
  return ['!not_valid', Object.keys((await sql`select 1 as ${ sql('!not_valid') }`)[0])[0]]
})

t('dynamic select as', async() => {
  return ['2', (await sql`select ${ sql({ a: 1, b: 2 }) }`)[0].b]
})

t('dynamic select as pluck', async() => {
  return [undefined, (await sql`select ${ sql({ a: 1, b: 2 }, 'a') }`)[0].b]
})

t('dynamic insert', async() => {
  await sql`create table test (a int, b text)`
  const x = { a: 42, b: 'the answer' }

  return ['the answer', (await sql`insert into test ${ sql(x) } returning *`)[0].b, await sql`drop table test`]
})

t('dynamic insert pluck', async() => {
  await sql`create table test (a int, b text)`
  const x = { a: 42, b: 'the answer' }

  return [null, (await sql`insert into test ${ sql(x, 'a') } returning *`)[0].b, await sql`drop table test`]
})

t('dynamic in with empty array', async() => {
  await sql`create table test (a int)`
  await sql`insert into test values (1)`
  return [
    (await sql`select * from test where null in ${ sql([]) }`).count,
    0,
    await sql`drop table test`
  ]
})

t('dynamic in after insert', async() => {
  await sql`create table test (a int, b text)`
  const [{ x }] = await sql`
    with x as (
      insert into test values (1, 'hej')
      returning *
    )
    select 1 in ${ sql([1, 2, 3]) } as x from x
  `
  return [
    true, x,
    await sql`drop table test`
  ]
})

t('array insert', async() => {
  await sql`create table test (a int, b int)`
  return [2, (await sql`insert into test (a, b) values ${ sql([1, 2]) } returning *`)[0].b, await sql`drop table test`]
})

t('where parameters in()', async() => {
  await sql`create table test (x text)`
  await sql`insert into test values ('a')`
  return [
    (await sql`select * from test where x in ${ sql(['a', 'b', 'c']) }`)[0].x,
    'a',
    await sql`drop table test`
  ]
})

t('where parameters in() values before', async() => {
  return [2, (await sql`
    with rows as (
      select * from (values (1), (2), (3), (4)) as x(a)
    )
    select * from rows where a in ${ sql([3, 4]) }
  `).count]
})

t('dynamic multi row insert', async() => {
  await sql`create table test (a int, b text)`
  const x = { a: 42, b: 'the answer' }

  return [
    'the answer',
    (await sql`insert into test ${ sql([x, x]) } returning *`)[1].b, await sql`drop table test`
  ]
})

t('dynamic update', async() => {
  await sql`create table test (a int, b text)`
  await sql`insert into test (a, b) values (17, 'wrong')`

  return [
    'the answer',
    (await sql`update test set ${ sql({ a: 42, b: 'the answer' }) } returning *`)[0].b, await sql`drop table test`
  ]
})

t('dynamic update pluck', async() => {
  await sql`create table test (a int, b text)`
  await sql`insert into test (a, b) values (17, 'wrong')`

  return [
    'wrong',
    (await sql`update test set ${ sql({ a: 42, b: 'the answer' }, 'a') } returning *`)[0].b, await sql`drop table test`
  ]
})

t('dynamic select array', async() => {
  await sql`create table test (a int, b text)`
  await sql`insert into test (a, b) values (42, 'yay')`
  return ['yay', (await sql`select ${ sql(['a', 'b']) } from test`)[0].b, await sql`drop table test`]
})

t('dynamic returning array', async() => {
  await sql`create table test (a int, b text)`
  return [
    'yay',
    (await sql`insert into test (a, b) values (42, 'yay') returning ${ sql(['a', 'b']) }`)[0].b,
    await sql`drop table test`
  ]
})

t('dynamic select args', async() => {
  await sql`create table test (a int, b text)`
  await sql`insert into test (a, b) values (42, 'yay')`
  return ['yay', (await sql`select ${ sql('a', 'b') } from test`)[0].b, await sql`drop table test`]
})

t('dynamic values single row', async() => {
  const [{ b }] = await sql`
    select * from (values ${ sql(['a', 'b', 'c']) }) as x(a, b, c)
  `

  return ['b', b]
})

t('dynamic values multi row', async() => {
  const [, { b }] = await sql`
    select * from (values ${ sql([['a', 'b', 'c'], ['a', 'b', 'c']]) }) as x(a, b, c)
  `

  return ['b', b]
})

t('Multiple queries', async() => {
  const sql = postgres(options)

  return [4, (await Promise.all([
    sql`select 1`,
    sql`select 2`,
    sql`select 3`,
    sql`select 4`
  ])).length]
})

t('Multiple statements', async() =>
  [2, await sql.unsafe(`
    select 1 as x;
    select 2 as a;
  `).then(([, [x]]) => x.a)]
)

t('Insert empty array', async() => {
  await sql`create table tester (ints int[])`
  return [
    Array.isArray((await sql`insert into tester (ints) values (${ [] }) returning *`)[0].ints),
    true,
    await sql`drop table tester`
  ]
})

t('Insert array in sql()', async() => {
  await sql`create table tester (ints int[])`
  return [
    Array.isArray((await sql`insert into tester ${ sql({ ints: [] }) } returning *`)[0].ints),
    true,
    await sql`drop table tester`
  ]
})

t('Escaping supports schemas and tables', async() => {
  await sql`create schema a`
  await sql`create table a.b (c int)`
  await sql`insert into a.b (c) values (1)`
  return [
    1,
    (await sql`select ${ sql('a.b.c') } from a.b`)[0].c,
    await sql`drop table a.b`,
    await sql`drop schema a`
  ]
})

t('Raw method returns values unparsed as Buffer', async() => {
  const [[x]] = await sql`select 1`.raw()
  return [
    x instanceof Uint8Array,
    true
  ]
})

t('Fragments', async() => [
  1,
  (await sql`
    ${ sql`select` } 1 as x
  `)[0].x
])

t('Supports fragments as dynamic parameters', async() => {
  await sql`create table test (a int, b bool)`
  await sql`insert into test values(1, true)`
  await sql`insert into test ${
    sql({
      a: 2,
      b: sql`exists(select 1 from test where b = ${ true })`
    })
  }`

  return [
    '1,t2,t',
    (await sql`select * from test`.raw()).join(''),
    await sql`drop table test`
  ]
})

t('Supports nested fragments with parameters', async() => {
  await sql`create table test ${
    sql`(${ sql('a') } ${ sql`int` })`
  }`
  await sql`insert into test values(1)`
  return [
    1,
    (await sql`select a from test`)[0].a,
    await sql`drop table test`
  ]
})

t('Supports multiple nested fragments with parameters', async() => {
  const [{ b }] = await sql`select * ${
    sql`from ${
      sql`(values (2, ${ 1 }::int)) as x(${ sql(['a', 'b']) })`
    }`
  }`
  return [
    1,
    b
  ]
})

t('Supports arrays of fragments', async() => {
  const [{ x }] = await sql`
    ${ [sql`select`, sql`1`, sql`as`, sql`x`] }
  `

  return [
    1,
    x
  ]
})

t('Last keyword used even with duplicate keywords', async() => {
  await sql`create table test (x int)`
  await sql`insert into test values(1)`
  const [{ x }] = await sql`
    select
      1 in (1) as x
    from test
    where x in ${ sql([1, 2]) }
  `

  return [x, true, await sql`drop table test`]
})

t('Insert array with null', async() => {
  await sql`create table test (x int[])`
  await sql`insert into test ${ sql({ x: [1, null, 3] }) }`
  return [
    1,
    (await sql`select x from test`)[0].x[0],
    await sql`drop table test`
  ]
})

t('Named arguments in a function call (#1040)', async() => {
  const [{ x }] = await sql`select make_interval(${ sql({ days: 1, hours: 2 }) })::text as x`
  return ['1 day 02:00:00', x]
})
