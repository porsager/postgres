import { exec } from './bootstrap.js'
import { t } from './test.js'

const postgres = (await import(process.env.POSTGRES_JS || '../src/index.js')).default

export { exec, postgres }

const log = console.log
const notice = x => x && typeof x === 'object' && 'severity_local' in x && !/^(ERROR|FATAL|PANIC)$/.test(x.severity)
console.log = (...xs) => xs.length === 1 && notice(xs[0]) ? undefined : log(...xs)

export const delay = ms => new Promise(r => setTimeout(r, ms))
export const rel = x => new URL(x, import.meta.url)
export const idle_timeout = 1

export const login = {
  user: 'postgres_js_test'
}

export const login_md5 = {
  user: 'postgres_js_test_md5',
  pass: 'postgres_js_test_md5'
}

export const login_scram = {
  user: 'postgres_js_test_scram',
  pass: 'postgres_js_test_scram'
}

export const options = {
  db: 'postgres_js_test',
  user: login.user,
  pass: login.pass,
  idle_timeout,
  connect_timeout: 1,
  max: 1,
  ...(process.env.POOLER_PORT ? { host: 'localhost', port: +process.env.POOLER_PORT } : {}),
  ...(process.env.PREPARE === 'false' ? { prepare: false } : {}),
  ...(process.env.INFER === 'true' ? { infer: true } : {})
}

export const sql = postgres(options)

const reset = postgres({ ...options, onnotice: () => {} })
t.before = () => reset`drop table if exists test cascade`.catch(() => {})
