import fs from 'fs'
import crypto from 'crypto'
import { t } from './test.js'
import { postgres, sql, options, rel } from './setup.js'

t('Result is array', async() =>
  [true, Array.isArray(await sql`select 1`)]
)

t('Result has count', async() =>
  [1, (await sql`select 1`).count]
)

t('Result has command', async() =>
  ['SELECT', (await sql`select 1`).command]
)

t('Create table', async() =>
  ['CREATE TABLE', (await sql`create table test(int int)`).command, await sql`drop table test`]
)

t('Drop table', async() => {
  await sql`create table test(int int)`
  return ['DROP TABLE', (await sql`drop table test`).command]
})

t('Big result', async() => {
  return [100000, (await sql`select * from generate_series(1, 100000)`).count]
})

t('Result has columns spec', async() =>
  ['x', (await sql`select 1 as x`).columns[0].name]
)

t('Result as arrays', async() => {
  const sql = postgres({
    ...options,
    transform: {
      row: x => Object.values(x)
    }
  })

  return ['1,2', (await sql`select 1 as a, 2 as b`)[0].join(',')]
})

t('Raw method returns rows as arrays', async() => {
  const [x] = await sql`select 1`.raw()
  return [
    Array.isArray(x),
    true
  ]
})

t('Array returns rows as arrays of columns', async() => {
  return [(await sql`select 1`.values())[0][0], 1]
})

t('Execute', async() => {
  const result = await new Promise((resolve) => {
    const sql = postgres({ ...options, fetch_types: false, debug:(id, query) => resolve(query) })
    sql`select 1`.execute()
  })

  return [result, 'select 1']
})

t('Cancel running query', async() => {
  const query = sql`select pg_sleep(2)`
  setTimeout(() => query.cancel(), 500)
  const error = await query.catch(x => x)
  return ['57014', error.code]
})

t('Cancel piped query', { timeout: 5 }, async() => {
  await sql`select 1`
  const last = sql`select pg_sleep(1)`.execute()
  const query = sql`select pg_sleep(2) as dig`
  setTimeout(() => query.cancel(), 500)
  const error = await query.catch(x => x)
  await last
  return ['57014', error.code]
})

t('Cancel queued query', async() => {
  const query = sql`select pg_sleep(2) as nej`
  const tx = sql.begin(sql => (
    query.cancel(),
    sql`select pg_sleep(0.5) as hej, 'hejsa'`
  ))
  const error = await query.catch(x => x)
  await tx
  return ['57014', error.code]
})

t('Result becomes array', async() => [
  true,
  (await sql`select 1`).slice() instanceof Array
])

t('Include table oid and column number in column details', async() => {
  await sql`create table tester (name text, age int)`
  const r = await sql`select name, age from tester where name like $1 and age > $2`.describe()
  const [{ oid }] = await sql`select oid from pg_class where relname = 'tester'`

  return [
    `table:${oid},number:1|table:${oid},number:2`,
    `${ r.columns.map(c => `table:${c.table},number:${c.number}`).join('|') }`,
    await sql`drop table tester`
  ]
})

t('Large object', async() => {
  const file = rel('index.js')
      , md5 = crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')

  const lo = await sql.largeObject()
  await new Promise(async r => fs.createReadStream(file).pipe(await lo.writable()).on('finish', r))
  await lo.seek(0)

  const out = crypto.createHash('md5')
  await new Promise(r => lo.readable().then(x => x.on('data', x => out.update(x)).on('end', r)))

  return [
    md5,
    out.digest('hex'),
    await lo.close()
  ]
})

t('Large object tell, size, truncate, and ranges for readable and writable', async() => {
  const lo = await sql.largeObject()
      , read = async o => { let s = ''; for await (const x of await lo.readable(o)) s += x; return s }
  await lo.write(Buffer.from('0123456789'))
  const [tell] = await lo.tell()
      , [size] = await lo.size()
  await lo.seek(0)
  const range = await read({ start: 2, end: 6 })
      , rest = await read({ highWaterMark: 4 })
      , writable = await lo.writable({ start: 3 })
  await new Promise(r => writable.end('abc', r))
  await lo.seek(0)
  const all = await read()
  await lo.truncate(4)
  const [truncated] = await lo.size()
  return [
    '10 10 10 2345 6789 012abc6789 4',
    [tell.lo_tell64, size.position, size.size, range, rest, all, truncated.size].join(' '),
    await lo.close()
  ]
})

t('Multiple statements give one result each', async() => {
  await sql`create table test (x int)`
  const xs = await sql.unsafe('update test set x = 1; delete from test; select 1 as a')
  return ['3:UPDATE,DELETE,SELECT', xs.length + ':' + xs.map(x => x.command).join(), await sql`drop table test`]
})

t('Error mid-result does not offset rows of next query', async() => {
  const sql = postgres({ ...options, max: 1 })
  await sql`select 1 / (g - 3) from generate_series(1, 5) g`.catch(x => x)
  const result = await sql`select 1 as x`
  await sql.end()
  return [1, result.length]
})

t('Result is not sparse after a query errors mid row-stream', async() => {
  const sql = postgres({ ...options, max: 1 })
  await sql`select n, 1 / (3 - n) as boom from generate_series(1, 5) n`.catch(() => {})
  const result = await sql`select x from generate_series(1, 3) x`
  await sql.end()
  return ['3:1,2,3', result.length + ':' + result.map(r => r.x).join(',')]
})

t('Undefined value in a pipelined query rejects only that query', async() => {
  const sql = postgres(options)
  await sql`select 1`
  const results = await Promise.all([
    sql`select pg_sleep(0.1), 1 as x`,
    sql`select ${ undefined } as x`,
    sql`select 3 as x`
  ].map(x => x.then(([x]) => x.x, e => e.code)))
  const after = (await sql`select 4 as x`)[0].x
  await sql.end()
  return ['1,UNDEFINED_VALUE,3,4', [...results, after].join()]
})

t('Undefined value in a pipelined cursor rejects only that query', async() => {
  const sql = postgres(options)
  await sql`select 1`
  const results = await Promise.all([
    sql`select pg_sleep(0.1), 1 as x`,
    sql`select ${ undefined } as x`.cursor(() => {}),
    sql`select 3 as x`
  ].map(x => x.then(x => x.length ? x[0].x : x.command, e => e.code)))
  const after = (await sql`select 4 as x`)[0].x
  await sql.end()
  return ['1,UNDEFINED_VALUE,3,4', [...results, after].join()]
})

t('Too many parameters in a pipelined query rejects only that query', async() => {
  const sql = postgres(options)
  await sql`select 1`
  const results = await Promise.all([
    sql`select pg_sleep(0.1), 1 as x`,
    sql.unsafe('select 2 as x', [...Array(65535).keys()]),
    sql`select 3 as x`,
    sql`select 4 as x`
  ].map(x => x.then(([x]) => x.x, e => e.code)))
  const after = (await sql`select 5 as x`)[0].x
  await sql.end()
  return ['1,MAX_PARAMETERS_EXCEEDED,3,4,5', [...results, after].join()]
})

t('Parameter failing to serialize in a pipelined cursor rejects only that query', async() => {
  const sql = postgres(options)
  await sql`select 1`
  const results = await Promise.all([
    sql`select pg_sleep(0.1), 1 as x`,
    sql`select ${ new Date(NaN) }::timestamptz as x`.cursor(() => {}),
    sql`select 3 as x`
  ].map(x => x.then(x => x.length ? x[0].x : x.command, e => e.name)))
  const after = (await sql`select 4 as x`)[0].x
  await sql.end()
  return ['1,RangeError,3,4', [...results, after].join()]
})

t('Cancel piped query with a query piped behind it', async() => {
  await sql`select 1`
  const last = sql`select pg_sleep(0.5)`.execute()
  const query = sql`select pg_sleep(2) as dig`
  setTimeout(() => query.cancel(), 100)
  const [error, [{ x }]] = await Promise.all([query.catch(x => x), sql`select 1 as x`])
  await last
  return ['57014,1', error.code + ',' + x]
})


t('Cancel returns a promise', async() => {
  const query = sql`select pg_sleep(1)`.execute()
  const cancelled = query.cancel()
  const error = await query.catch(x => x)
  return ['true,57014', (cancelled instanceof Promise) + ',' + error.code]
})

t('result.statement and query.statement have the documented name, string, types and columns', async() => {
  const q = sql`select ${ 1 }::int as a`
  const r = await q
  const s = await sql.unsafe('select 1 as b')
  return [
    'select $1::int as a|23|a|true||select 1 as b|b',
    [r.statement.string, r.statement.types.join(), r.statement.columns.map(x => x.name).join(), q.statement.string === r.statement.string,
     s.statement.name, s.statement.string, s.statement.columns.map(x => x.name).join()].join('|')
  ]
})

t('debug gets the values as sent and the parameter types, also on first use', async() => {
  const calls = []
  const sql = postgres({ ...options, max: 1, debug: (id, query, values, types) => calls.push(JSON.stringify([values, types])) })
  await sql`select ${ 1 }::int as x`
  await sql`select ${ 1 }::int as x`
  return ['[["1"],[23]] [["1"],[23]]', calls.slice(-2).join(' '), await sql.end()]
})

t('Inspecting a query with debug shows why it can not be built', async() => {
  const util = await import('util')
      , sql = postgres({ ...options, debug: true })
  return ['Query { UNDEFINED_VALUE: Undefined values are not allowed }', util.inspect(sql`select ${ undefined }`), await sql.end()]
})

t('.stream() says it is now .forEach()', async() => [
  '.stream has been renamed to .forEach',
  (() => { try { sql`select 1`.stream() } catch (e) { return e.message } })()
])

t('.finally() runs the query', async() => {
  let ran = false
  const [x] = await sql`select 1 as x`.finally(() => ran = true)
  return ['1 true', x.x + ' ' + ran]
})

t('A deferred constraint failing at the end of an implicit transaction rejects the query (#1117, #1090)', async() => {
  await sql`create table test (x int constraint test_unique unique deferrable initially deferred)`
  await sql`insert into test values (1)`
  const codes = [
    await sql`insert into test ${ sql({ x: 1 }) }`.then(() => 'ran', e => e.code),
    await sql.unsafe('insert into test values (1)').then(() => 'ran', e => e.code),
    await sql`select count(*)::int as n from test`.then(([x]) => x.n)
  ]
  return ['23505 23505 1', codes.join(' '), await sql`drop table test`]
})
