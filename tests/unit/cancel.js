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
