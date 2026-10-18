import { t } from './test.js'
import { postgres, options } from './setup.js'

t('Transform undefined', async() => {
  const sql = postgres({ ...options, transform: { undefined: null } })
  return [null, (await sql`select ${ undefined } as x`)[0].x]
})

t('Transform undefined in array', async() => {
  const sql = postgres({ ...options, transform: { undefined: null } })
  return [null, (await sql`select * from (values ${ sql([undefined, undefined]) }) as x(x, y)`)[0].y]
})

t('transform column', async() => {
  const sql = postgres({
    ...options,
    transform: { column: x => x.split('').reverse().join('') }
  })

  await sql`create table test (hello_world int)`
  await sql`insert into test values (1)`
  return ['dlrow_olleh', Object.keys((await sql`select * from test`)[0])[0], await sql`drop table test`]
})

t('column toPascal', async() => {
  const sql = postgres({
    ...options,
    transform: { column: postgres.toPascal }
  })

  await sql`create table test (hello_world int)`
  await sql`insert into test values (1)`
  return ['HelloWorld', Object.keys((await sql`select * from test`)[0])[0], await sql`drop table test`]
})

t('column toCamel', async() => {
  const sql = postgres({
    ...options,
    transform: { column: postgres.toCamel }
  })

  await sql`create table test (hello_world int)`
  await sql`insert into test values (1)`
  return ['helloWorld', Object.keys((await sql`select * from test`)[0])[0], await sql`drop table test`]
})

t('column toKebab', async() => {
  const sql = postgres({
    ...options,
    transform: { column: postgres.toKebab }
  })

  await sql`create table test (hello_world int)`
  await sql`insert into test values (1)`
  return ['hello-world', Object.keys((await sql`select * from test`)[0])[0], await sql`drop table test`]
})

t('Transform nested json in arrays', async() => {
  const sql = postgres({
    ...options,
    transform: postgres.camel
  })
  return ['aBcD', (await sql`select '[{"a_b":1},{"c_d":2}]'::jsonb as x`)[0].x.map(Object.keys).join('')]
})

t('Transform deeply nested json object in arrays', async() => {
  const sql = postgres({
    ...options,
    transform: postgres.camel
  })
  return [
    'childObj_deeplyNestedObj_grandchildObj',
    (await sql`
      select '[{"nested_obj": {"child_obj": 2, "deeply_nested_obj": {"grandchild_obj": 3}}}]'::jsonb as x
    `)[0].x.map(x => {
      let result
      for (const key in x)
        result = [...Object.keys(x[key]), ...Object.keys(x[key].deeplyNestedObj)]
      return result
    })[0]
    .join('_')
  ]
})

t('Transform deeply nested json array in arrays', async() => {
  const sql = postgres({
    ...options,
    transform: postgres.camel
  })
  return [
    'childArray_deeplyNestedArray_grandchildArray',
    (await sql`
      select '[{"nested_array": [{"child_array": 2, "deeply_nested_array": [{"grandchild_array":3}]}]}]'::jsonb AS x
    `)[0].x.map((x) => {
      let result
      for (const key in x)
        result = [...Object.keys(x[key][0]), ...Object.keys(x[key][0].deeplyNestedArray[0])]
      return result
    })[0]
    .join('_')
  ]
})

t('Bypass transform for json primitive', async() => {
  const sql = postgres({
    ...options,
    transform: postgres.camel
  })

  const x = (await sql`select 'null'::json as a, 'false'::json as b, '"a"'::json as c, '1'::json as d`)[0]

  return [
    JSON.stringify({ a: null, b: false, c: 'a', d: 1 }),
    JSON.stringify(x)
  ]
})

t('Bypass transform for jsonb primitive', async() => {
  const sql = postgres({
    ...options,
    transform: postgres.camel
  })

  const x = (await sql`select 'null'::jsonb as a, 'false'::jsonb as b, '"a"'::jsonb as c, '1'::jsonb as d`)[0]

  return [
    JSON.stringify({ a: null, b: false, c: 'a', d: 1 }),
    JSON.stringify(x)
  ]
})

t('Transform row', async() => {
  const sql = postgres({
    ...options,
    transform: { row: () => 1 }
  })

  return [1, (await sql`select 'wat'`)[0]]
})

t('Transform row forEach', async() => {
  let result
  const sql = postgres({
    ...options,
    transform: { row: () => 1 }
  })

  await sql`select 1`.forEach(x => result = x)

  return [1, result]
})

t('Transform value', async() => {
  const sql = postgres({
    ...options,
    transform: { value: () => 1 }
  })

  return [1, (await sql`select 'wat' as x`)[0].x]
})

t('Transform columns from', async() => {
  const sql = postgres({
    ...options,
    transform: postgres.fromCamel
  })
  await sql`create table test (a_test int, b_test text)`
  await sql`insert into test ${ sql([{ aTest: 1, bTest: 1 }]) }`
  await sql`update test set ${ sql({ aTest: 2, bTest: 2 }) }`
  return [
    2,
    (await sql`select ${ sql('aTest', 'bTest') } from test`)[0].a_test,
    await sql`drop table test`
  ]
})

t('Transform columns to', async() => {
  const sql = postgres({
    ...options,
    transform: postgres.toCamel
  })
  await sql`create table test (a_test int, b_test text)`
  await sql`insert into test ${ sql([{ a_test: 1, b_test: 1 }]) }`
  await sql`update test set ${ sql({ a_test: 2, b_test: 2 }) }`
  return [
    2,
    (await sql`select a_test, b_test from test`)[0].aTest,
    await sql`drop table test`
  ]
})

t('Transform columns from and to', async() => {
  const sql = postgres({
    ...options,
    transform: postgres.camel
  })
  await sql`create table test (a_test int, b_test text)`
  await sql`insert into test ${ sql([{ aTest: 1, bTest: 1 }]) }`
  await sql`update test set ${ sql({ aTest: 2, bTest: 2 }) }`
  return [
    2,
    (await sql`select ${ sql('aTest', 'bTest') } from test`)[0].aTest,
    await sql`drop table test`
  ]
})

t('Transform columns from and to (legacy)', async() => {
  const sql = postgres({
    ...options,
    transform: {
      column: {
        to: postgres.fromCamel,
        from: postgres.toCamel
      }
    }
  })
  await sql`create table test (a_test int, b_test text)`
  await sql`insert into test ${ sql([{ aTest: 1, bTest: 1 }]) }`
  await sql`update test set ${ sql({ aTest: 2, bTest: 2 }) }`
  return [
    2,
    (await sql`select ${ sql('aTest', 'bTest') } from test`)[0].aTest,
    await sql`drop table test`
  ]
})

t('Insert array with undefined transform', async() => {
  const sql = postgres({ ...options, transform: { undefined: null } })
  await sql`create table test (x int[])`
  await sql`insert into test ${ sql({ x: [1, undefined, 3] }) }`
  return [
    1,
    (await sql`select x from test`)[0].x[0],
    await sql`drop table test`
  ]
})

t('transform.row applies to .values() rows too, as in v3', async() => {
  const sql = postgres({ ...options, transform: { row: { from: row => (row.transformed = true, row) } } })
  const [row] = await sql`select 1 as a`.values()
  return ['1 true', row[0] + ' ' + row.transformed, await sql.end()]
})
