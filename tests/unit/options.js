import { t } from '../test.js'
import postgres from '../../src/index.js'

const parsed = (url, o) => {
  const x = postgres(url, { max: 1, ...o }).options
  return JSON.stringify([x.host, x.port, x.user, x.pass, x.database, x.path || null])
}

t('A bracketed IPv6 host in a url (#1232)', async() => [
  JSON.stringify([['::1'], [5433], 'u', 'p', 'db', null]),
  parsed('postgres://u:p@[::1]:5433/db')
])

t('Several bracketed IPv6 hosts with ports in a url (#1232)', async() => [
  JSON.stringify([['::1', '2001:db8::1'], [1, 5432], 'u', 'p', 'db', null]),
  parsed('postgres://u:p@[::1]:1,[2001:db8::1]/db')
])

t('A percent-encoded socket directory as the host of a url (#1057)', async() => [
  JSON.stringify([['/var/run/postgresql'], [5433], 'u', '', 'db', '/var/run/postgresql/.s.PGSQL.5433']),
  parsed('postgres://u@%2Fvar%2Frun%2Fpostgresql:5433/db')
])

t('A host in the query of a url, as libpq reads it (#984)', async() => [
  JSON.stringify([['/run/postgresql'], [5432], 'u', '', 'db', '/run/postgresql/.s.PGSQL.5432']),
  parsed('postgres://u@localhost/db?host=/run/postgresql')
])

t('A url with no host and a host in its query (#984)', async() => [
  JSON.stringify([['/run/postgresql'], [5432], 'u', '', 'db', '/run/postgresql/.s.PGSQL.5432']),
  parsed('postgres:///db?host=/run/postgresql', { user: 'u' })
])

t('A password with characters that are not percent-encoded is used as written (#735, #890)', async() => [
  JSON.stringify([['h'], [5432], 'u', 'p@ss#w%rd\\x', 'db', null]),
  parsed('postgres://u:p@ss#w%rd\\x@h/db')
])

t('A percent-encoded password is decoded (#735)', async() => [
  JSON.stringify([['h'], [5432], 'u', 'p%ss#w@rd', 'db', null]),
  parsed('postgres://u:p%25ss%23w%40rd@h/db')
])

t('Hosts with ports in the host option, as in v3', async() => [
  JSON.stringify([['a', 'b'], [1, 2], 'u', '', 'db', null]),
  parsed(undefined, { host: 'a:1,b:2', user: 'u', database: 'db' })
])

t('A port option applies to every host', async() => [
  JSON.stringify([['a', 'b'], [7, 7], 'u', '', 'db', null]),
  parsed('postgres://u@a:1,b:2/db', { port: 7 })
])

t('disable and false in the query of a url turn an option off', async() => {
  const x = postgres('postgres://u@h/db?prepare=false&ssl=disable&fetch_types=false', { max: 1 }).options
  return ['false false false', [x.prepare, x.ssl, x.fetch_types].join(' ')]
})

t('An unsupported target_session_attrs throws', async() => [
  'target_session_attrs any is not supported',
  (() => { try { postgres({ target_session_attrs: 'any' }) } catch (e) { return e.message } })()
])

t('sql.array() is removed, and says so', async() => [
  'ARRAY_REMOVED',
  (() => { try { postgres({ max: 1 }).array([1]) } catch (e) { return e.code } })()
])

t('channel_binding from options, the url and PGCHANNELBINDING, as libpq reads it', async() => {
  const before = process.env.PGCHANNELBINDING
  process.env.PGCHANNELBINDING = 'disable'
  const read = [
    postgres({ max: 1 }).options.channel_binding,
    postgres('postgres://u@h/db?channel_binding=require', { max: 1 }).options.channel_binding,
    postgres({ max: 1, channel_binding: 'prefer' }).options.channel_binding,
    postgres('postgres://u@h/db?channel_binding=require', { max: 1 }).options.connection.channel_binding
  ]
  before === undefined ? delete process.env.PGCHANNELBINDING : process.env.PGCHANNELBINDING = before
  const invalid = (() => { try { postgres({ channel_binding: 'yes' }) } catch (e) { return e.message } })()
  return ['disable,require,prefer, channel_binding yes is not supported', read.join() + ' ' + invalid]
})

t('The scheduler is on by default, and off with scheduler: false, scheduler=false in the url, or max: 1', async() => [
  'true false false false',
  [
    postgres({ max: 2 }).options.scheduler,
    postgres({ max: 2, scheduler: false }).options.scheduler,
    postgres('postgres://u@h/db?scheduler=false', { max: 2 }).options.scheduler,
    postgres({ max: 1 }).options.scheduler
  ].join(' ')
])
