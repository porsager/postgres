import { t } from '../test.js'
import { PostgresError } from '../../src/errors.js'
import postgres from '../../src/index.js'

const here = new URL(import.meta.url).pathname
const offline = () => postgres({ host: 'localhost', port: 1, connect_timeout: 1, max: 1 })

t('PostgresError from server fields', async() => {
  const e = new PostgresError({ message: 'division by zero', code: '22012', severity: 'ERROR' })
  return [
    'true|PostgresError|division by zero|22012|ERROR',
    [e instanceof Error, e.name, e.message, e.code, e.severity].join('|')
  ]
})

t('PostgresError from a message string', async() => {
  const e = new PostgresError('Error message.')
  return ['Error message.|false', e.message + '|' + ('0' in e)]
})

t('PostgresError is exported from the package', async() => [
  true,
  postgres.PostgresError === PostgresError
])

t('Connection error stack is writable and configurable', async() => {
  const sql = offline()
  const e = await sql`select 1`.catch(x => x)
  await sql.end()
  const d = Object.getOwnPropertyDescriptor(e, 'stack')
  e.stack = 'y'
  return ['true,true,y', [d ? d.writable !== false || !!d.set : true, d ? d.configurable : true, e.stack].join()]
})

t('Connection error stack includes the calling line', async() => {
  const sql = offline()
  const e = await sql`select 1`.catch(x => x)
  await sql.end()
  return [true, e.stack.includes(here)]
})

t('Undefined value error stack includes the calling line', async() => {
  const sql = offline()
  const e = await sql`select ${ undefined }`.catch(x => x)
  await sql.end()
  return ['UNDEFINED_VALUE|true', e.code + '|' + e.stack.includes(here)]
})

t('Not tagged error has a code', async() => {
  const sql = offline()
  const e = await Promise.resolve().then(() => sql('select 1')).catch(x => x)
  await sql.end()
  return ['NOT_TAGGED_CALL', e.code]
})
