import { t } from './test.js'
import { postgres, sql, options } from './setup.js'

const same = xs => xs.every(x => JSON.stringify(x) === JSON.stringify(xs[0]) && Object.keys(x).join() === Object.keys(xs[0]).join())

t('Rows keep the same shape and values across many rows', async() => {
  const rows = await sql`
    select
      1 as "1",
      'x' as a,
      null::int as n,
      true as b,
      2 as a,
      'q' as "we""ird",
      'y' as "}; throw 1; //",
      1.5::float8 as f,
      '2026-06-01T00:00:00Z'::timestamptz as d,
      '{1,2}'::int[] as arr,
      '{"k":1}'::json as j
    from generate_series(1, 40)
  `
  return [
    '40 true 2 null true 1 [1,2] 1',
    [
      rows.length, same(rows), rows[39].a, String(rows[39].n), rows[39].d instanceof Date,
      rows[39]['1'], JSON.stringify(rows[39].arr), rows[39].j.k
    ].join(' ')
  ]
})

t('Rows with a __proto__ column stay plain objects', async() => {
  const rows = await sql`select 'x' as "__proto__", 1 as a from generate_series(1, 40)`
  return [
    'true true',
    rows.every(x => Object.getPrototypeOf(x) === Object.prototype) + ' ' + rows.every(x => x.a === 1)
  ]
})

t('Rows from .values() are arrays across many rows', async() => {
  const rows = await sql`select 1 as a, 'x' as a, null as b from generate_series(1, 40)`.values()
  return [
    'true [1,"x",null]',
    rows.every(x => Array.isArray(x) && JSON.stringify(x) === '[1,"x",null]') + ' ' + JSON.stringify(rows[39])
  ]
})

t('Rows from .raw() are buffers across many rows', async() => {
  const rows = await sql`select 1 as a, null as b from generate_series(1, 40)`.raw()
  return [
    'true',
    '' + rows.every(x => Buffer.isBuffer(x[0]) && x[0].toString() === '1' && x[1] === null)
  ]
})

t('Rows apply value and column transforms across many rows', async() => {
  const sql = postgres({
    ...options,
    transform: {
      column: { from: x => x.toUpperCase() },
      value: { from: (x, column) => column.type === 23 && x !== null ? x * 10 : x }
    }
  })
  const rows = await sql`select 1 as a, 'x' as b, null::int as c from generate_series(1, 40)`
  return [
    'true',
    '' + rows.every(x => x.A === 10 && x.B === 'x' && x.C === null && Object.keys(x).join() === 'A,B,C'),
    await sql.end()
  ]
})

t('Rows reach forEach across many rows', async() => {
  let n = 0
  await sql`select i, 'x' as s from generate_series(1, 40) as i`.forEach(x => n += x.i + x.s.length)
  return [860, n]
})

t('A column named __proto__ is an own property and does not become the prototype of the row', async() => {
  const results = []
  for (const n of [1, 40]) {
    const rows = await sql`select 'alice' as name, '{"isAdmin": true}'::json as "__proto__" from generate_series(1, ${ n })`
        , row = rows[rows.length - 1]
        , own = Object.getOwnPropertyDescriptor(row, '__proto__')
    results.push([typeof row.isAdmin, Object.getPrototypeOf(row) === Object.prototype, Object.keys(row).join('+'), own.value.isAdmin].join(' '))
  }
  return ['undefined true name+__proto__ true|undefined true name+__proto__ true', results.join('|')]
})
