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

t('Calling signal() again removes the previous abort listener', async() => {
  const clock = Clock()
      , server = Server({ clock, random: Random(1), delay: 0, split: 0 })
      , sql = postgres({
        host: 'sim', port: 5432, user: 'sim', database: 'sim', max: 1, fetch_types: false,
        max_lifetime: 0, idle_timeout: 0, timers: clock.timers,
        socket: () => server.socket()
      })
      , ac1 = new AbortController()
      , ac2 = new AbortController()

  const q = sql`select 1 as id, 0 as scope sleep(100)`.signal(ac1.signal).signal(ac2.signal)
  let outcome
  q.then(rows => outcome = 'rows:' + rows.length, e => outcome = 'err:' + e.code)
  await clock.run(20)
  ac1.abort()
  await clock.run(200)
  return ['rows:1', outcome]
})

t('Cursor async iterator clears query_timeout timer and abort listener on completion', async() => {
  const clock = Clock()
      , server = Server({ clock, random: Random(1), delay: 0, split: 0 })
      , sql = postgres({
        host: 'sim', port: 5432, user: 'sim', database: 'sim', max: 1, fetch_types: false,
        max_lifetime: 0, idle_timeout: 0, query_timeout: 5, timers: clock.timers,
        socket: () => server.socket()
      })
      , ac = new AbortController()
      , q = sql`select 1 as id, 0 as scope`.signal(ac.signal)

  let removed = false
  const origRemove = ac.signal.removeEventListener.bind(ac.signal)
  ac.signal.removeEventListener = (...args) => (removed = true, origRemove(...args))

  const rows = []
  const iter = q.cursor(1)[Symbol.asyncIterator]()
  const done = (async() => {
    for (;;) {
      const step = await iter.next()
      if (step.done) break
      rows.push(...step.value)
    }
  })()
  await clock.run(200)
  await done
  return ['1,true,0', rows.length + ',' + removed + ',' + clock.pending]
})
