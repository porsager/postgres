import { t } from './test.js'

/** Registers native subscription ownership regressions.
 * @param inputs The public postgres constructor and real database connection options.
 * @returns No value; the existing test runner owns both scenarios.
 */
export function listenReconnectTests({ postgres, options }) {
  // @behavior original-listen-unsubscribe-after-reconnect
  // @boundary before=two-listeners at=reconnect-and-unsubscribe after=one-listener-until-last-unsubscribe
  // @red original-listen-unsubscribe-after-reconnect Recreated identities retain the removed callback and LISTEN registration.
  // @green original-listen-unsubscribe-after-reconnect Original handles release reconnected registrations separately.
  t('Given two listeners reconnect, When original handles unsubscribe, Then only retained listeners receive notifications', async() => {
    const sql = postgres(options)
        , xs = []
        , arrivals = {}
        , a = new Promise(r => arrivals.a = r)
        , b = new Promise(r => arrivals.b = r)
        , c = new Promise(r => arrivals.c = r)
        , ready = {}
        , reconnected = new Promise(r => ready.reconnected = r)
    let registrations = 0

    try {
      const s1 = await sql.listen('test', x => xs.push('1', x), () => {
        if (++registrations === 2) ready.reconnected()
      })
      const s2 = await sql.listen('test', x => {
        xs.push('2', x)
        arrivals[x]()
      })
      await sql.notify('test', 'a')
      await a
      await sql`select pg_terminate_backend(${ s1.state.pid })`
      await reconnected
      await sql.notify('test', 'b')
      await b
      await s1.unlisten()
      await sql.notify('test', 'c')
      // The retained user callback is a positive notification barrier after unsubscribe.
      await c
      await s2.unlisten()
      const [{ available }] = await sql`select 1 as available`
      const [{ retained }] = await sql`
        select count(*)::int as retained from pg_stat_activity
        where pid = ${ s2.state.pid } and query ilike 'listen %'
      `
      return ['1a2a1b2b2c:1:0', xs.join('') + ':' + available + ':' + retained]
    } finally { await sql.end() }
  })

  // @behavior unsubscribe-during-listen-reconnect
  // @boundary before=two-reconnecting-listeners at=close-before-ready after=only-retained-listener-ready-and-notified
  // @red unsubscribe-during-listen-reconnect Recreated identities or unguarded ready callbacks resurrect the closed subscription.
  // @green unsubscribe-during-listen-reconnect Stable ownership and current membership preserve only the retained listener.
  t('Given listeners reconnect, When a pending subscription closes, Then only the retained listener becomes ready and receives notifications', async() => {
    const sql = postgres(options)
        , callbacks = []
        , resolvers = {}
        , released = new Promise(r => resolvers.released = r)
        , received = new Promise(r => resolvers.received = r)
    let firstRegistrations = 0
        , secondRegistrations = 0

    try {
      const first = await sql.listen('pending_unsubscribe', () => {
        callbacks.push('first')
        resolvers.received()
      }, () => {
        if (++firstRegistrations === 2) second.unlisten().then(resolvers.released)
      })
      const second = await sql.listen('pending_unsubscribe', () => callbacks.push('second'), () => secondRegistrations++)
      await sql`select pg_terminate_backend(${ first.state.pid })`
      // The first ready callback closes the second handle while its shared LISTEN await is still pending.
      await released
      await sql.notify('pending_unsubscribe', 'after-unsubscribe')
      await received
      return ['first:1', callbacks.join(',') + ':' + secondRegistrations]
    } finally { await sql.end() }
  })
}
