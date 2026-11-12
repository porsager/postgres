import { t } from '../test.js'
import postgres from '../../src/index.js'
import { Clock, Random } from '../sim/net.js'
import { Server } from '../sim/server.js'

t('A canceled sql.batch leaves no cancel_timeout timer behind', async() => {
  const clock = Clock()
      , server = Server({ clock, random: Random(1), delay: 0, split: 0 })
      , sql = postgres({
        host: 'sim', port: 5432, user: 'sim', database: 'sim', max: 1, fetch_types: false,
        max_lifetime: 0, idle_timeout: 0, cancel_timeout: 5, timers: clock.timers,
        socket: () => server.socket()
      })

  const q = sql.batch([sql`select 1 as id, 0 as scope sleep(1000)`])
  let code
  q.then(() => code = 'resolved', e => code = e.code)
  await clock.run(100)
  q.cancel()
  await clock.run(200)
  await clock.run(300)
  return ['57014,0', code + ',' + clock.pending]
})


t('A queued reserve() can be cancelled while waiting for a pool lease', async() => {
  const sql = postgres({ max: 0, fetch_types: false, host: '127.0.0.1', port: 1 })
  const pending = sql.reserve()
  let code
  pending.then(() => code = 'resolved', e => code = e.code)
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  const waiting = sql.stats.waiting
  await pending.cancel()
  await Promise.resolve()
  await sql.end({ timeout: 0 })
  return ['57014,1,0', [code, waiting, sql.stats.waiting].join(',')]
})

t('A queued begin() can be cancelled while waiting for a pool lease', async() => {
  const sql = postgres({ max: 0, fetch_types: false, host: '127.0.0.1', port: 1 })
  let entered = false
  const pending = sql.begin(async() => { entered = true })
  let code
  pending.then(() => code = 'resolved', e => code = e.code)
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  const waiting = sql.stats.waiting
  await pending.cancel()
  await Promise.resolve()
  await sql.end({ timeout: 0 })
  return ['57014,1,0,false', [code, waiting, sql.stats.waiting, entered].join(',')]
})
