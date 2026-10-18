import { t } from './test.js'
import { postgres, options, delay } from './setup.js'

const until = async(fn, ms = 5000) => {
  const end = Date.now() + ms
  while (!await fn()) {
    if (Date.now() > end)
      throw new Error('Timed out waiting')
    await delay(10)
  }
}

t('listen and notify', async() => {
  const sql = postgres(options)
  const channel = 'hello'
  const result = await new Promise(async r => {
    await sql.listen(channel, r)
    sql.notify(channel, 'works')
  })

  return [
    'works',
    result,
    sql.end()
  ]
})

t('double listen', async() => {
  const sql = postgres(options)
      , channel = 'hello'

  let count = 0

  await new Promise((resolve, reject) =>
    sql.listen(channel, resolve)
    .then(() => sql.notify(channel, 'world'))
    .catch(reject)
  ).then(() => count++)

  await new Promise((resolve, reject) =>
    sql.listen(channel, resolve)
    .then(() => sql.notify(channel, 'world'))
    .catch(reject)
  ).then(() => count++)

  sql.listen('weee', () => {}).then(sql.end)

  return [2, count]
})

t('multiple listeners work after a reconnect', async() => {
  const sql = postgres(options)
      , xs = []

  let listens = 0
  try {
    const s1 = await sql.listen('test', x => xs.push('1', x), () => listens++)
    await sql.listen('test', x => xs.push('2', x))
    await sql.notify('test', 'a')
    await until(() => xs.length === 4)
    await sql`select pg_terminate_backend(${ s1.state.pid })`
    await until(() => listens === 2)
    await sql.notify('test', 'b')
    await until(() => xs.length === 8)
    return ['1a2a1b2b', xs.join('')]
  } finally {
    await sql.end()
  }
})

t('listen and notify with weird name', async() => {
  const sql = postgres(options)
  const channel = 'wat-;.ø.§'
  let unlisten
  const result = await new Promise(async r => {
    unlisten = (await sql.listen(channel, r)).unlisten
    sql.notify(channel, 'works')
  })
  await unlisten()

  return [
    'works',
    result,
    sql.end()
  ]
})

t('listen and notify with upper case', async() => {
  const sql = postgres(options)
  const channel = 'withUpperChar'
  const result = await new Promise(async r => {
    await sql.listen(channel, r)
    sql.notify(channel, 'works')
  })

  return [
    'works',
    result,
    sql.end()
  ]
})

t('listen reconnects', async() => {
  const sql = postgres(options)
      , resolvers = {}
      , a = new Promise(r => resolvers.a = r)
      , b = new Promise(r => resolvers.b = r)

  let connects = 0

  const { state: { pid } } = await sql.listen(
    'test',
    x => x in resolvers && resolvers[x](),
    () => connects++
  )
  await sql.notify('test', 'a')
  await a
  await sql`select pg_terminate_backend(${ pid })`
  await until(() => connects === 2)
  await sql.notify('test', 'b')
  await b
  sql.end()
  return [connects, 2]
})

t('listen result reports correct connection state after reconnection', async() => {
  const sql = postgres(options)
      , xs = []

  const result = await sql.listen('test', x => xs.push(x))
  const initialPid = result.state.pid
  await sql.notify('test', 'a')
  await sql`select pg_terminate_backend(${ initialPid })`
  await until(() => result.state.pid && result.state.pid !== initialPid)
  sql.end()

  return [result.state.pid !== initialPid, true]
})

t('unlisten removes subscription', async() => {
  const sql = postgres(options)
      , xs = []

  const { unlisten } = await sql.listen('test', x => xs.push(x))
  await sql.notify('test', 'a')
  await until(() => xs.length === 1)
  await unlisten()
  await sql.notify('test', 'b')
  await delay(50)
  sql.end()

  return ['a', xs.join('')]
})

t('listen after unlisten', async() => {
  const sql = postgres(options)
      , xs = []

  const { unlisten } = await sql.listen('test', x => xs.push(x))
  await sql.notify('test', 'a')
  await until(() => xs.length === 1)
  await unlisten()
  await sql.notify('test', 'b')
  await delay(50)
  await sql.listen('test', x => xs.push(x))
  await sql.notify('test', 'c')
  await until(() => xs.length === 2)
  sql.end()

  return ['ac', xs.join('')]
})

t('multiple listeners and unlisten one', async() => {
  const sql = postgres(options)
      , xs = []

  await sql.listen('test', x => xs.push('1', x))
  const s2 = await sql.listen('test', x => xs.push('2', x))
  await sql.notify('test', 'a')
  await until(() => xs.length === 4)
  await s2.unlisten()
  await sql.notify('test', 'b')
  await until(() => xs.length === 6)
  await delay(50)
  sql.end()

  return ['1a2a1b', xs.join('')]
})

t('Listen connection closes after the last unlisten', async() => {
  const sql = postgres(options)
  const { state: { pid }, unlisten } = await sql.listen('test', () => {})
  await unlisten()
  const gone = async() => (await sql`select count(*)::int as n from pg_stat_activity where pid = ${ pid }`)[0].n === 0
  await until(gone)
  return [true, await gone(), await sql.end()]
})

t('Original listen handles unsubscribe after a reconnect', async() => {
  const sql = postgres(options)
      , xs = []
      , arrivals = {}
      , a = new Promise(r => arrivals.a = r)
      , b = new Promise(r => arrivals.b = r)
      , c = new Promise(r => arrivals.c = r)
  let registrations = 0
    , reconnect

  const reconnected = new Promise(r => reconnect = r)

  try {
    const s1 = await sql.listen('test', x => xs.push('1', x), () => ++registrations === 2 && reconnect())
    const s2 = await sql.listen('test', x => (xs.push('2', x), arrivals[x]()))
    await sql.notify('test', 'a')
    await a
    await sql`select pg_terminate_backend(${ s1.state.pid })`
    await reconnected
    await sql.notify('test', 'b')
    await b
    await s1.unlisten()
    await sql.notify('test', 'c')
    await c
    await s2.unlisten()
    const [{ available }] = await sql`select 1 as available`
    const [{ retained }] = await sql`
      select count(*)::int as retained from pg_stat_activity
      where pid = ${ s2.state.pid } and query ilike 'listen %'
    `
    return ['1a2a1b2b2c:1:0', xs.join('') + ':' + available + ':' + retained]
  } finally {
    await sql.end()
  }
})

t('Unlisten while reconnecting keeps only the other listener', async() => {
  const sql = postgres(options)
      , callbacks = []
  let released
    , received
    , first = 0
    , second = 0

  const unlistened = new Promise(r => released = r)
      , arrived = new Promise(r => received = r)

  try {
    await sql.listen('test', () => (callbacks.push('first'), received()), () => ++first === 2 && b.unlisten().then(released))
    const b = await sql.listen('test', () => callbacks.push('second'), () => second++)
    await sql`select pg_terminate_backend(${ b.state.pid })`
    await unlistened
    await sql.notify('test', 'after')
    await arrived
    return ['first:1', callbacks.join(',') + ':' + second]
  } finally {
    await sql.end()
  }
})

t('A listener that throws keeps its connection and gets the next notification', async() => {
  const sql = postgres(options)
  const got = []
  let onlisten = 0
  await sql.listen('throwing', x => {
    got.push(x)
    if (x === 'throw')
      throw new Error('listener throws')
  }, () => onlisten++)
  await sql.notify('throwing', 'throw')
  await until(() => got.length === 1)
  await sql.notify('throwing', 'after')
  await until(() => got.length === 2)
  return ['1 throw,after', onlisten + ' ' + got.join(), await sql.end()]
})

t('unlisten after end resolves without a query', async() => {
  const sql = postgres(options)
  const { unlisten } = await sql.listen('after_end', () => {})
  await sql.end()
  return ['done', await unlisten().then(() => 'done')]
})
