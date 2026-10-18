import { t } from './test.js'
import { postgres, sql, options, delay } from './setup.js'

t('null', async() =>
  [null, (await sql`select ${ null } as x`)[0].x]
)

t('Integer', async() =>
  ['1', (await sql`select ${ 1 } as x`)[0].x]
)

t('String', async() =>
  ['hello', (await sql`select ${ 'hello' } as x`)[0].x]
)

t('Boolean false', async() =>
  [false, (await sql`select ${ false }::bool as x`)[0].x]
)

t('Boolean true', async() =>
  [true, (await sql`select ${ true }::bool as x`)[0].x]
)

t('Date', async() => {
  const now = new Date()
  return [0, now - (await sql`select ${ now }::timestamptz as x`)[0].x]
})

t('infer: true types booleans, dates and arrays of them without a cast, as v3 did', async() => {
  const sql = postgres({ ...options, infer: true })
  const now = new Date()
  const [x] = await sql`select ${ true } as a, ${ false } as b, ${ now } as c, ${ [now, now] } as d, ${ [true, false] } as e`
  return [
    'true false 0 0 true,false',
    [x.a, x.b, now - x.c, now - x.d[1], x.e.join()].join(' '),
    await sql.end()
  ]
})

t('infer: false leaves untyped parameters to the server, so they come back as text without a cast', async() => {
  const sql = postgres({ ...options, infer: false })
  const [x] = await sql`select ${ true } as a, ${ new Date(0) } as b`
  return ['string string', typeof x.a + ' ' + typeof x.b, await sql.end()]
})

t('Json', async() => {
  const x = (await sql`select ${ sql.json({ a: 'hello', b: 42 }) } as x`)[0].x
  return ['hello,42', [x.a, x.b].join()]
})

t('implicit json', async() => {
  const x = (await sql`select ${ { a: 'hello', b: 42 } }::json as x`)[0].x
  return ['hello,42', [x.a, x.b].join()]
})

t('implicit jsonb', async() => {
  const x = (await sql`select ${ { a: 'hello', b: 42 } }::jsonb as x`)[0].x
  return ['hello,42', [x.a, x.b].join()]
})

t('Empty array', async() =>
  [true, Array.isArray((await sql`select ${ [] }::text[] as x`)[0].x)]
)

t('String array', async() =>
  ['123', (await sql`select ${ '{1,2,3}' }::int[] as x`)[0].x.join('')]
)

t('Array of Integer', async() =>
  [3, (await sql`select ${ [1, 2, 3] }::int[] as x`)[0].x[2]]
)

t('Array of String', async() =>
  ['c', (await sql`select ${ ['a', 'b', 'c'] }::text[] as x`)[0].x[2]]
)

t('Array of Date', async() => {
  const now = new Date()
  return [now.getTime(), (await sql`select ${ [now, now, now] }::timestamptz[] as x`)[0].x[2].getTime()]
})

t('Array of Box', async() => [
  '(3,4),(1,2);(6,7),(4,5)',
  (await sql`select ${ '{(1,2),(3,4);(4,5),(6,7)}' }::box[] as x`)[0].x.join(';')
])

t('Nested array n2', async() =>
  [4, (await sql`select ${ [[1, 2], [3, 4]] }::int[] as x`)[0].x[1][1]]
)

t('Nested array n3', async() =>
  [6, (await sql`select ${ [[[1, 2]], [[3, 4]], [[5, 6]]] }::int[] as x`)[0].x[2][0][1]]
)

t('Escape in arrays', async() =>
  ['Hello "you",c:\\windows', (await sql`select ${ ['Hello "you"', 'c:\\windows'] }::text[] as x`)[0].x.join(',')]
)

t('null for int', async() => {
  await sql`create table test (x int)`
  return [1, (await sql`insert into test values(${ null })`).count, await sql`drop table test`]
})

t('Null sets to null', async() =>
  [null, (await sql`select ${ null } as x`)[0].x]
)

t('Point type', async() => {
  const sql = postgres({
    ...options,
    types: {
      point: {
        to: 600,
        from: [600],
        serialize: ([x, y]) => '(' + x + ',' + y + ')',
        parse: (x) => x.slice(1, -1).split(',').map(x => +x)
      }
    }
  })

  await sql`create table test (x point)`
  await sql`insert into test (x) values (${ sql.types.point([10, 20]) })`
  return [20, (await sql`select x from test`)[0].x[1], await sql`drop table test`]
})

t('Point type array', async() => {
  const sql = postgres({
    ...options,
    types: {
      point: {
        to: 600,
        from: [600],
        serialize: ([x, y]) => '(' + x + ',' + y + ')',
        parse: (x) => x.slice(1, -1).split(',').map(x => +x)
      }
    }
  })

  await sql`create table test (x point[])`
  await sql`insert into test (x) values (${ [sql.types.point([10, 20]), sql.types.point([20, 30])] })`
  return [30, (await sql`select x from test`)[0].x[1][1], await sql`drop table test`]
})

t('bytea serializes and parses', async() => {
  const buf = Buffer.from('wat')

  await sql`create table test (x bytea)`
  await sql`insert into test values (${ buf })`

  return [
    buf.toString(),
    (await sql`select x from test`)[0].x.toString(),
    await sql`drop table test`
  ]
})

t('bigint is returned as String', async() => [
  'string',
  typeof (await sql`select 9223372036854777 as x`)[0].x
])

t('int is returned as Number', async() => [
  'number',
  typeof (await sql`select 123 as x`)[0].x
])

t('numeric is returned as string', async() => [
  'string',
  typeof (await sql`select 1.2 as x`)[0].x
])

const show = x => Array.isArray(x)
  ? '[' + x.map(show) + ']'
  : x === null ? 'null' : x instanceof Date ? 'date:' + x.getTime() : typeof x + ':' + x

t('Null in text array', async() => [
  '[string:a,null,string:b]',
  show((await sql`select array['a', null, 'b']::text[] as x`)[0].x)
])

t('Null in arrays of other types', async() => {
  const x = (await sql`
    select
      array[1, null]::int2[] as int2,
      array[null, 2]::int4[] as int4,
      array[1, null]::bigint[] as bigint,
      array[1.5, null]::numeric[] as numeric,
      array[true, null, false]::bool[] as bool,
      array['1970-01-01 00:00:00+00'::timestamptz, null] as timestamptz
  `)[0]

  return [
    '[number:1,null],[null,number:2],[string:1,null],[string:1.5,null],[boolean:true,null,boolean:false],[date:0,null]',
    [x.int2, x.int4, x.bigint, x.numeric, x.bool, x.timestamptz].map(show).join()
  ]
})

t('Null in json array', async() => [
  '[object:[object Object],null]',
  show((await sql`select array['{"a":1}'::json, null] as x`)[0].x)
])

t('Null in array_agg', async() => [
  '[string:a,null,string:b]',
  show((await sql`select array_agg(y) as x from (values ('a'), (null), ('b')) as v(y)`)[0].x)
])

t('Null in nested arrays', async() => {
  const x = (await sql`
    select
      array[[1, null], [null, 4]]::int[] as ints,
      array[[['a', null]], [[null, 'd e']]]::text[] as strings
  `)[0]

  return [
    '[[number:1,null],[null,number:4]],[[[string:a,null]],[[null,string:d e]]]',
    [x.ints, x.strings].map(show).join()
  ]
})

t('Null in array of only nulls', async() => [
  '[null,null]',
  show((await sql`select array[null, null]::text[] as x`)[0].x)
])

t('String NULL in array is not null', async() => [
  '[string:NULL,null,string:null,string:Null]',
  show((await sql`select array['NULL', null, 'null', 'Null']::text[] as x`)[0].x)
])

t('String NULL in nested array is not null', async() => [
  '[[string:NULL,null],[null,string:NULL]]',
  show((await sql`select array[['NULL', null], [null, 'NULL']]::text[] as x`)[0].x)
])

t('String NULL in array round trips', async() => [
  '[string:NULL,null,string:a]',
  show((await sql`select ${ ['NULL', null, 'a'] }::text[] as x`)[0].x)
])

t('Null in array does not reach custom type parser', async() => {
  const parsed = []
  const sql = postgres({
    ...options,
    types: {
      text: { to: 25, from: [25], serialize: x => x, parse: x => (parsed.push(x), x.toUpperCase()) }
    }
  })

  const x = (await sql`select array['a', null, 'NULL']::text[] as x`)[0].x
  await sql.end()
  return ['[string:A,null,string:NULL]/a,NULL', show(x) + '/' + parsed.join()]
})

t('Infinity timestamp parses to Infinity', async() =>
  [Infinity, (await sql`select 'infinity'::timestamptz as x`)[0].x]
)

t('-Infinity timestamp parses to -Infinity', async() =>
  [-Infinity, (await sql`select '-infinity'::timestamptz as x`)[0].x]
)

t('Infinity timestamp round-trips', async() =>
  [Infinity, (await sql`select ${ sql.typed(Infinity, 1184) } as x`)[0].x]
)

t('-Infinity timestamp round-trips', async() =>
  [-Infinity, (await sql`select ${ sql.typed(-Infinity, 1184) } as x`)[0].x]
)

t('Date before year 100', async() => {
  const sql = postgres({ ...options, connection: { TimeZone: 'UTC' } })
  const [{ x }] = await sql`select '0050-06-15 12:30:00+00'::timestamptz as x`
  return ['0050-06-15T12:30:00.000Z', x.toISOString(), await sql.end()]
})

t('Date with an offset in seconds', async() => {
  const sql = postgres({ ...options, connection: { TimeZone: 'Europe/Copenhagen' } })
  const [{ x, y }] = await sql`
    select '1850-06-15 12:30:00+00'::timestamptz as x, '0050-06-15 12:30:00+00'::timestamptz as y
  `
  return ['1850-06-15T12:30:00.000Z,0050-06-15T12:30:00.000Z', x.toISOString() + ',' + y.toISOString(), await sql.end()]
})

t('Domain type wrapping an array resolves to the base type serializer, for a domain made before the pool starts', async() => {
  await sql`drop domain if exists pg_test_domain_array cascade`
  await sql`create domain pg_test_domain_array as text[]`
  await sql`create table test (x pg_test_domain_array)`
  const fresh = postgres(options)
  return [
    'a,b',
    (await fresh`insert into test values (${ ['a', 'b'] }) returning x`)[0].x.join(','),
    await fresh.end(),
    await sql`drop table test`,
    await sql`drop domain pg_test_domain_array`
  ]
})

t('Nested domain types resolve through to their base type serializer, for a domain made before the pool starts', async() => {
  await sql`drop domain if exists pg_test_domain_nested_child cascade`
  await sql`drop domain if exists pg_test_domain_nested_parent cascade`
  await sql`create domain pg_test_domain_nested_parent as text[]`
  await sql`create domain pg_test_domain_nested_child as pg_test_domain_nested_parent`
  await sql`create table test (x pg_test_domain_nested_child)`
  const fresh = postgres(options)
  return [
    'a,b',
    (await fresh`insert into test values (${ ['a', 'b'] }) returning x`)[0].x.join(','),
    await fresh.end(),
    await sql`drop table test`,
    await sql`drop domain pg_test_domain_nested_child`,
    await sql`drop domain pg_test_domain_nested_parent`
  ]
})

t('Built-in array types without fetch_types', async() => {
  const sql = postgres({ ...options, fetch_types: false })
  const [{ x, y }] = await sql`select array['a', 'b']::text[] as x, array[1, 2]::int4[] as y`
  const [{ z }] = await sql`select ${ ['c', 'd'] }::text[] as z`
  return ['b,2,d', [x[1], y[1], z[1]].join(), await sql.end()]
})

t('Object with a type key in a jsonb array', async() => {
  await sql`create table test (nodes jsonb[])`
  await sql`insert into test ${ sql({ nodes: [{ type: 'a', v: 1 }] }) }`
  const [{ nodes }] = await sql`select nodes from test`
  return ['a,1', nodes[0].type + ',' + nodes[0].v, await sql`drop table test`]
})

t('infer: false sends a boolean to a jsonb parameter', async() => {
  const sql = postgres({ ...options, infer: false })
  return [true, (await sql`select ${ true }::jsonb as x`)[0].x, await sql.end()]
})

t('infer: false sends a boolean array', async() => {
  const sql = postgres({ ...options, infer: false })
  return ['true,false', (await sql`select ${ [true, false] }::bool[] as x`)[0].x.join(), await sql.end()]
})

t('infer: false sends strings to boolean, bytea and date parameters as text', async() => {
  const sql = postgres({ ...options, infer: false, max: 1 })
  await sql`create temp table shapes (a boolean, b bytea, c timestamptz, d boolean[])`
  await sql`insert into shapes values (${ 'yes' }, ${ '\\x4142' }, ${ '2026-10-17T12:00:00Z' }, ${ ['t', false] })`
  const [x] = await sql`select a, encode(b, 'escape') as b, c, d from shapes`
  return [
    'true AB 2026-10-17T12:00:00.000Z true,false',
    [x.a, x.b, x.c.toISOString(), x.d].join(' '),
    await sql.end()
  ]
})

t('infer: false writes a Date to a timestamp column as the instant it is, not in the session time zone', async() => {
  const sql = postgres({ ...options, infer: false, max: 1, connection: { TimeZone: 'America/New_York' } })
  await sql`create temp table stamps (at timestamp)`
  await sql`insert into stamps values (${ new Date('2026-10-17T12:00:00Z') })`
  const [{ at }] = await sql`select at::text from stamps`
  return ['2026-10-17 12:00:00', at, await sql.end()]
})

t('infer: false reads a timestamp column back as the instant that was written', async() => {
  const sql = postgres({ ...options, infer: false, max: 1, connection: { TimeZone: 'America/New_York' } })
  await sql`create table test (at timestamp, ats timestamp[])`
  const date = new Date('2026-06-01T12:00:00.123Z')
  await sql`insert into test values (${ date }, ${ [date] })`
  const [{ at, ats }] = await sql`select at, ats from test`
  return [
    date.toISOString() + ' ' + date.toISOString(),
    at.toISOString() + ' ' + ats[0].toISOString(),
    await sql`drop table test`,
    await sql.end()
  ]
})

t('Custom type serializes values the server says are of a type in its from (#1129)', async() => {
  const sql = postgres({
    ...options,
    max: 1,
    types: {
      point: {
        to: 600,
        from: [600],
        serialize: ([x, y]) => '(' + x + ',' + y + ')',
        parse: x => x.slice(1, -1).split(',').map(Number)
      }
    }
  })
  await sql`create temp table points (p point)`
  await sql`insert into points values (${ [1, 2] })`
  const [{ p }] = await sql`select p from points`
  return ['1,2', p.join(), await sql.end()]
})

async function enumTable(name, rows) {
  await sql.unsafe([
    'drop table if exists ' + name,
    'drop type if exists ' + name + '_mood',
    'create type ' + name + '_mood as enum (\'a\', \'b\')',
    'create table ' + name + ' (m ' + name + '_mood)',
    ...(rows ? ['insert into ' + name + ' values ' + rows] : [])
  ].join(';'))
  return () => sql.unsafe('drop table ' + name + '; drop type ' + name + '_mood')
}

t('A column of a type Postgres.js does not know returns its rows as text, empty or not', async() => {
  const drop = await enumTable('test_enum_rows')
  const fresh = postgres(options)
  const empty = await fresh`select m from test_enum_rows`
  await sql`insert into test_enum_rows values ('a'), ('b')`
  const tagged = await fresh`select m from test_enum_rows order by m`
      , simple = await fresh.unsafe('select m from test_enum_rows order by m')
      , many = await fresh.unsafe('select m from test_enum_rows order by m; select 1 as n')
  await fresh.end()
  await drop()
  return ['0 a,b a,b a,b 1', [empty.length, tagged.map(x => x.m), simple.map(x => x.m), many[0].map(x => x.m), many[1][0].n].join(' ')]
})

t('forEach and cursors get every row of a column of a type Postgres.js does not know', async() => {
  const drop = await enumTable('test_enum_each', '(\'a\'), (\'b\'), (\'a\')')
  const fresh = postgres(options)
  const seen = []
      , batches = []
  await fresh`select m from test_enum_each`.forEach(row => seen.push(row.m))
  await fresh`select m from test_enum_each`.cursor(2, rows => { batches.push(rows.length) })
  await fresh.end()
  await drop()
  return ['3 2,1', seen.length + ' ' + batches.join()]
})

t('A parameter of a type Postgres.js does not know keeps its place among the queries after it', async() => {
  const drop = await enumTable('test_enum_order')
  const fresh = postgres({ ...options, max: 1 })
  await fresh`select 1`
  const [, select] = await fresh.begin(sql => [
    sql`insert into test_enum_order values (${ 'a' })`,
    sql`select count(*)::int as n from test_enum_order`
  ])
  const commands = await Promise.all([
    fresh`begin`,
    fresh`insert into test_enum_order values (${ 'b' })`,
    fresh`rollback`
  ]).then(x => x.map(x => x.command))
  const [{ n }] = await fresh`select count(*)::int as n from test_enum_order`
  await fresh.end()
  await drop()
  return ['1 BEGIN,INSERT,ROLLBACK 1', select[0].n + ' ' + commands.join() + ' ' + n]
})

t('infer: false writes a Date for a text parameter as an ISO timestamp', async() => {
  const sql = postgres({ ...options, infer: false, max: 1 })
  const [{ x }] = await sql`select ${ new Date('2026-06-01T12:00:00.123Z') }::text as x`
  return ['2026-06-01T12:00:00.123Z', x, await sql.end()]
})

t('An array in a values list is written as an array for a cast (#741)', async() => {
  const [{ r }] = await sql`select (v.r)::real[] as r from (values ${ sql([[1, [1.25, 3.5]]]) }) as v(id, r)`
  return ['1.25,3.5', r.join()]
})

t('An object in a values list is written as json for a cast (#872, #765)', async() => {
  const [{ j }] = await sql`select (v.j)::jsonb as j from (values ${ sql([[1, { a: 1, b: [true, null] }]]) }) as v(id, j)`
  return ['{"a":1,"b":[true,null]}', JSON.stringify(j)]
})

t('infer: false writes a boolean array to a jsonb parameter and a bigint to numeric (#931, #874)', async() => {
  const sql = postgres({ ...options, infer: false })
  const [{ j, n }] = await sql`select ${ [true, false] }::jsonb as j, ${ 1n << 255n }::numeric(78,0)::text as n`
  return ['[true,false] ' + (1n << 255n), JSON.stringify(j) + ' ' + n, await sql.end()]
})

t('A bigint array is written to an int8[] column (#837)', async() => {
  const [{ x }] = await sql`select ${ [9007199254740994n, 1n] }::int8[]::text as x`
  return ['{9007199254740994,1}', x]
})

t('A custom type given by name is looked up, with its array type (#1115)', async() => {
  await sql`drop type if exists pair_t cascade`
  await sql`create type pair_t as (a int, b int)`
  const sql2 = postgres({
    ...options,
    types: {
      pair: {
        to: 'pair_t',
        from: ['pair_t'],
        serialize: x => '(' + x.join(',') + ')',
        parse: x => x.slice(1, -1).split(',').map(Number)
      }
    }
  })
  const [{ x, xs, sum }] = await sql2`
    select
      ${ sql2.typed.pair([1, 2]) }::pair_t as x,
      array[${ sql2.typed.pair([3, 4]) }::pair_t] as xs,
      (${ sql2.typed.pair([5, 6]) }::pair_t).a as sum
  `
  await sql2.end()
  await sql`drop type pair_t`
  return ['1,2 3,4 5', x.join() + ' ' + xs[0].join() + ' ' + sum]
})

t('Several custom type names that do not exist are named in one TYPE_NOT_FOUND', async() => {
  const sql2 = postgres({ ...options, types: { a: { to: 'no_such_a', serialize: String }, b: { to: 'no_such_b', serialize: String } } })
  const message = await sql2`select 1`.then(() => 'ran', e => e.code + ' ' + e.message)
  await sql2.end()
  return ['TYPE_NOT_FOUND TYPE_NOT_FOUND: The types no_such_a, no_such_b do not exist', message]
})

t('A custom type name that does not exist rejects with TYPE_NOT_FOUND', async() => {
  const sql2 = postgres({ ...options, types: { nope: { to: 'no_such_type', from: ['no_such_type'], serialize: String, parse: String } } })
  const codes = [
    await sql2`select 1`.then(() => 'ran', e => e.code),
    await sql2.begin(sql => sql`select 1`).then(() => 'ran', e => e.code)
  ]
  await sql2.end()
  return ['TYPE_NOT_FOUND TYPE_NOT_FOUND', codes.join(' ')]
})

t('A custom type created after a failed lookup is found on a later query', { timeout: 10 }, async() => {
  await sql`drop type if exists later_t cascade`
  const sql2 = postgres({ ...options, types: { later: { to: 'later_t', from: ['later_t'], serialize: String, parse: x => 'parsed ' + x } } })
  const first = await sql2`select 1`.then(() => 'ran', e => e.code)
  await sql`create type later_t as enum ('a')`
  await delay(1100)
  const [{ x }] = await sql2`select 'a'::later_t as x`
  await sql2.end()
  await sql`drop type later_t`
  return ['TYPE_NOT_FOUND parsed a', first + ' ' + x]
})

t('Custom types by name need fetch_types', async() => {
  let code
  try {
    postgres({ ...options, fetch_types: false, types: { x: { to: 'x', from: ['x'], serialize: String, parse: String } } })
  } catch (e) {
    code = e.code
  }
  return ['TYPE_NOT_FOUND', code]
})
