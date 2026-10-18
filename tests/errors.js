import { t } from './test.js'
import { postgres, sql, options, login_md5, rel, idle_timeout, delay } from './setup.js'

t('Undefined values throws', async() => {
  let error

  await sql`
    select ${ undefined } as x
  `.catch(x => error = x.code)

  return ['UNDEFINED_VALUE', error]
})

t('Throw syntax error', async() =>
  ['42601', (await sql`wat 1`.catch(x => x)).code]
)

t('Proper handling of non object Errors', async() => {
  const sql = postgres({ socket: () => { throw 'wat' } })

  return [
    'wat', await sql`select 1 as x`.catch(e => e.message)
  ]
})

t('Proper handling of null Errors', async() => {
  const sql = postgres({ socket: () => { throw null } })

  return [
    'null', await sql`select 1 as x`.catch(e => e.message)
  ]
})

t('sql file throws', async() =>
  ['ENOENT', (await sql.file(rel('selectomondo.sql')).catch(x => x.code))]
)

t('Throws if more than 65534 parameters', async() => {
  await sql`create table test (x int)`
  return ['MAX_PARAMETERS_EXCEEDED', (await sql`insert into test ${
    sql([...Array(65535).keys()].map(x => ({ x })))
  }`.catch(e => e.code)), await sql`drop table test`]
})

t('await sql() throws not tagged error', async() => {
  let error
  try {
    await sql('select 1')
  } catch (e) {
    error = e.code
  }
  return ['NOT_TAGGED_CALL', error]
})

t('sql().then throws not tagged error', async() => {
  let error
  try {
    sql('select 1').then(() => {})
  } catch (e) {
    error = e.code
  }
  return ['NOT_TAGGED_CALL', error]
})

t('sql().catch throws not tagged error', async() => {
  let error
  try {
    sql('select 1').catch(() => {})
  } catch (e) {
    error = e.code
  }
  return ['NOT_TAGGED_CALL', error]
})

t('sql().finally throws not tagged error', async() => {
  let error
  try {
    sql('select 1').finally(() => {})
  } catch (e) {
    error = e.code
  }
  return ['NOT_TAGGED_CALL', error]
})

t('little bobby tables', async() => {
  const name = 'Robert\'); DROP TABLE students;--'

  await sql`create table students (name text, age int)`
  await sql`insert into students (name) values (${ name })`

  return [
    name, (await sql`select name from students`)[0].name,
    await sql`drop table students`
  ]
})

t('throws correct error when authentication fails', async() => {
  const sql = postgres({
    ...options,
    ...login_md5,
    pass: 'wrong'
  })
  return ['28P01', await sql`select 1`.catch(e => e.code)]
})

t('notice', async() => {
  let notice
  const log = console.log
  console.log = function(x) {
    notice = x
  }

  const sql = postgres(options)

  await sql`create table if not exists users()`
  await sql`create table if not exists users()`

  console.log = log

  return ['NOTICE', notice.severity]
})

t('notice hook', async() => {
  let notice
  const sql = postgres({
    ...options,
    onnotice: x => notice = x
  })

  await sql`create table if not exists users()`
  await sql`create table if not exists users()`

  return ['NOTICE', notice.severity]
})

t('Debug', async() => {
  let result
  const sql = postgres({
    ...options,
    debug: (connection_id, str) => result = str
  })

  await sql`select 1`

  return ['select 1', result]
})

t('Async stack trace', async() => {
  const sql = postgres({ ...options, debug: false })
  return [
    parseInt(new Error().stack.split('\n')[1].match(':([0-9]+):')[1]) + 1,
    parseInt(await sql`error`.catch(x => x.stack.split('\n').pop().match(':([0-9]+):')[1]))
  ]
})

t('Debug has long async stack trace', async() => {
  const sql = postgres({ ...options, debug: true })

  const inlines = typeof Bun !== 'undefined'
  return [
    inlines ? 'true' : 'watyo',
    await yo().catch(x => inlines ? String(x.stack.includes('errors.js')) : x.stack.match(/wat|yo/g).join(''))
  ]

  function yo() {
    return wat()
  }

  function wat() {
    return sql`error`
  }
})

t('Error contains query string', async() => [
  'selec 1',
  (await sql`selec 1`.catch(err => err.query))
])

t('Error contains query serialized parameters', async() => [
  1,
  (await sql`selec ${ 1 }`.catch(err => err.parameters[0]))
])

t('Error contains query raw parameters', async() => [
  1,
  (await sql`selec ${ 1 }`.catch(err => err.args[0]))
])

t('Query and parameters on errorare not enumerable if debug is not set', async() => {
  const sql = postgres({ ...options, debug: false })

  return [
    false,
    (await sql`selec ${ 1 }`.catch(err => err.propertyIsEnumerable('parameters') || err.propertyIsEnumerable('query')))
  ]
})

t('Query and parameters are enumerable if debug is set', async() => {
  const sql = postgres({ ...options, debug: true })

  return [
    true,
    (await sql`selec ${ 1 }`.catch(err => err.propertyIsEnumerable('parameters') && err.propertyIsEnumerable('query')))
  ]
})

t('Postgres errors are of type PostgresError', async() =>
  [true, (await sql`bad keyword`.catch(e => e)) instanceof sql.PostgresError]
)

t('Catches query format errors', async() => [
  'wat',
  await sql.unsafe({ toString: () => { throw new Error('wat') } }).catch((e) => e.message)
])

t('A query that fails to encode leaves the connection usable', async() => {
  const sql = postgres({ ...options, max: 1 })
  const error = await sql.unsafe({ toString: () => { throw new Error('wat') } }).catch(e => e.message)
  const huge = await sql`select ${ { toJSON() { throw new Error('json') } } }::json`.catch(e => e.message)
  const [{ x }] = await sql`select 1 as x`
  return ['wat,json,1', [error, huge, x].join(), await sql.end()]
})

t('Catches type serialize errors', async() => {
  const sql = postgres({
    idle_timeout,
    types: {
      text: {
        from: 25,
        to: 25,
        parse: x => x,
        serialize: () => { throw new Error('watSerialize') }
      }
    }
  })

  return [
    'watSerialize',
    (await sql`select ${ 'wat' }`.catch(e => e.message))
  ]
})

t('Catches type parse errors', async() => {
  const sql = postgres({
    idle_timeout,
    types: {
      text: {
        from: 25,
        to: 25,
        parse: () => { throw new Error('watParse') },
        serialize: x => x
      }
    }
  })

  return [
    'watParse',
    (await sql`select 'wat'`.catch(e => e.message))
  ]
})

t('Insert array with undefined throws', async() => {
  await sql`create table test (x int[])`
  return [
    'UNDEFINED_VALUE',
    await sql`insert into test ${ sql({ x: [1, undefined, 3] }) }`.catch(e => e.code),
    await sql`drop table test`
  ]
})

t('A PostgresError has its fields and its message in JSON (#767)', async() => {
  await sql`create table test (x int check (x > 0))`
  const error = await sql`insert into test values (-1)`.catch(e => e)
  const json = JSON.parse(JSON.stringify(error))
  return [
    'PostgresError 23514 test_x_check test true',
    [json.name, json.code, json.constraint_name, json.table_name, json.message.includes('check constraint')].join(' '),
    await sql`drop table test`
  ]
})

t('The cached origin of a query does not keep the closure that made it alive (#1274)', async() => {
  const v8 = await import('v8')
      , vm = await import('vm')
  let gc
  try {
    v8.setFlagsFromString('--expose-gc')
    gc = vm.runInNewContext('gc')
  } catch (e) {
    return [true, true]
  }

  const refs = []
  await holding(refs)

  for (let i = 0; i < 5; i++) {
    await delay(10)
    gc()
  }

  return [true, refs[0].deref() === undefined]
})

function holding(refs) {
  const big = { data: Buffer.alloc(1e6) }
  refs.push(new WeakRef(big))
  return (function inner() {
    return sql`select ${ big.data.length } as n`
  }())
}
