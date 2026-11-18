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

t('Canceling a sql.batch queued behind another query honors cancel_timeout', async() => {
  const clock = Clock()
      , server = Server({ clock, random: Random(1), delay: 0, split: 0 })
      , sql = postgres({
        host: 'sim', port: 5432, user: 'sim', database: 'sim', max: 1, prepare: true, fetch_types: false,
        connect_timeout: 2, max_lifetime: 0, idle_timeout: 0, cancel_timeout: 0.1, timers: clock.timers,
        socket: () => server.socket()
      })

  sql`select ${ 1 }::int as id, ${ 0 }::int as scope`.catch(() => {})
  await clock.run(100)
  sql`select ${ 2 }::int as id, ${ 0 }::int as scope sleep(${ 100000 }::int)`.catch(() => {})
  await clock.run(110)
  const q = sql.batch([sql`select ${ 3 }::int as id, ${ 0 }::int as scope`])
  let done = false
  let canceled = false
  q.then(() => done = true, () => done = true)
  await clock.run(120)
  q.cancel().then(() => canceled = true, () => canceled = true)
  await clock.run(1000)
  const result = [done, canceled]
  sql.end({ timeout: 0 })
  await clock.run(1100)
  return [[true, true] + '', result + '']
})
