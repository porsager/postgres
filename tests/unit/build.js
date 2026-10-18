import util from 'util'
import { t } from '../test.js'
import postgres from '../../src/index.js'
import cases from './build.cases.js'

const sql = postgres({ host: 'localhost', port: 1, max: 1 })
const show = q => JSON.stringify([q.text, q.parameters])

cases.forEach(([name, fn, text, parameters]) =>
  t(name, async() => [JSON.stringify([text, parameters]), show(fn(sql))])
)

t('Insert and update helpers with no columns throw (#644)', async() => [
  'NO_COLUMNS NO_COLUMNS NO_COLUMNS',
  [
    () => sql`insert into x ${ sql({}) }`,
    () => sql`insert into x ${ sql({ a: 1 }, []) }`,
    () => sql`update x set ${ sql({}) }`
  ].map(fn => { try { fn().text } catch (e) { return e.code } }).join(' ')
])

t('Undefined values in any row of a multi row insert throw, whatever the order (#889)', async() => [
  'UNDEFINED_VALUE UNDEFINED_VALUE',
  [
    () => sql`insert into x ${ sql([{ a: 1, b: 1 }, { a: 2, b: undefined }]) }`,
    () => sql`insert into x ${ sql([{ a: 2, b: undefined }, { a: 1, b: 1 }]) }`
  ].map(fn => { try { fn().text } catch (e) { return e.code } }).join(' ')
])

t('A join has the length of the items it kept', async() => [
  '2 0',
  sql`and`.join([sql`a`, false, sql`b`]).length + ' ' + sql`and`.join([]).length
])

t('Transform column names in helpers', async() => {
  const sql = postgres({ host: 'localhost', port: 1, transform: postgres.camel })
  return [
    JSON.stringify(['insert into x ("foo_bar")values($1)', [1]]),
    show(sql`insert into x ${ sql({ fooBar: 1 }) }`)
  ]
})

t('Transform undefined to null', async() => {
  const sql = postgres({ host: 'localhost', port: 1, transform: { undefined: null } })
  return [JSON.stringify(['select $1', [null]]), show(sql`select ${ undefined }`)]
})

t('Inspect hides text and parameters without debug', async() => {
  const x = util.inspect(sql`select ${ 'secret' } as x`)
  return [false, x.includes('secret') || x.includes('select $1')]
})

t('Inspect shows text and parameters with debug', async() => {
  const sql = postgres({ host: 'localhost', port: 1, debug: true })
  const x = util.inspect(sql`select ${ 'secret' } as x`)
  return [true, x.includes('secret') && x.includes('select $1 as x')]
})

t('Building does not run the query', async() => {
  let ran = false
  const sql = postgres({ host: 'localhost', port: 1, debug: () => ran = true })
  sql`select 1`.text
  await new Promise(r => setTimeout(r, 10))
  return [false, ran]
})
