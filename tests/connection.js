import net from 'net'
import tls from 'tls'
import crypto from 'crypto'
import { t } from './test.js'
import { postgres, sql, options, login, login_md5, login_scram, delay, idle_timeout, exec } from './setup.js'

t('Connects with no options', async() => {
  const sql = postgres({ max: 1 })

  const result = (await sql`select 1 as x`)[0].x
  await sql.end()

  return [1, result]
})

t('Uses default database without slash', async() => {
  const sql = postgres('postgres://localhost')
  return [sql.options.user, sql.options.database]
})

t('Uses default database with slash', async() => {
  const sql = postgres('postgres://localhost/')
  return [sql.options.user, sql.options.database]
})

t('Connect using uri', async() =>
  [true, await new Promise((resolve, reject) => {
    const sql = postgres('postgres://' + login.user + ':' + (login.pass || '') + '@localhost:5432/' + options.db, {
      idle_timeout
    })
    sql`select 1`.then(() => resolve(true), reject)
  })]
)

t('Options from uri with special characters in user and pass', async() => {
  const opt = postgres({ user: 'öla', pass: 'pass^word' }).options
  return [[opt.user, opt.pass].toString(), 'öla,pass^word']
})

t('Fail with proper error on no host', async() =>
  ['ECONNREFUSED', (await new Promise((resolve, reject) => {
    const sql = postgres('postgres://localhost:33333/' + options.db, {
      idle_timeout
    })
    sql`select 1`.then(reject, resolve)
  })).code]
)

t('Connect using SSL', async() =>
  [true, (await new Promise((resolve, reject) => {
    postgres({
      ssl: { rejectUnauthorized: false },
      idle_timeout
    })`select 1`.then(() => resolve(true), reject)
  }))]
)

t('Connect using SSL require', async() =>
  [true, (await new Promise((resolve, reject) => {
    postgres({
      ssl: 'require',
      idle_timeout
    })`select 1`.then(() => resolve(true), reject)
  }))]
)

t('Connect using SSL direct', async() => {
  const [{ supported }] = await sql`select current_setting('server_version_num')::int >= 180000 as supported`
  return [true, !supported || (await new Promise((resolve, reject) => {
    postgres({
      ssl: 'require',
      sslnegotiation: 'direct',
      idle_timeout
    })`select 1`.then(() => resolve(true), reject)
  }))]
})

t('Connect using SSL prefer', async() => {
  await exec('psql', ['-c', 'alter system set ssl=off'])
  await exec('psql', ['-c', 'select pg_reload_conf()'])

  const sql = postgres({
    ssl: 'prefer',
    idle_timeout
  })

  return [
    1, (await sql`select 1 as x`)[0].x,
    await exec('psql', ['-c', 'alter system set ssl=on']),
    await exec('psql', ['-c', 'select pg_reload_conf()'])
  ]
})

t('Reconnect using SSL', async() => {
  const sql = postgres({
    ssl: 'require',
    idle_timeout: 0.1
  })

  await sql`select 1`
  await delay(200)

  return [1, (await sql`select 1 as x`)[0].x]
})

t('An ssl object builds one TLS context for its connections, and a new one when a value in it changes', async() => {
  const create = tls.createSecureContext
      , ssl = { rejectUnauthorized: false }
      , sql = postgres({ ...options, ssl, max: 4 })
  let built = 0
  tls.createSecureContext = (...xs) => (built++, create(...xs))
  try {
    const reserved = [await sql.reserve(), await sql.reserve(), await sql.reserve()]
        , first = built
    ssl.ca = tls.rootCertificates
    reserved.push(await sql.reserve())
    reserved.forEach(x => x.release())
    return ['1 2', first + ' ' + built]
  } finally {
    tls.createSecureContext = create
    await sql.end()
  }
})

t('Login without password', async() => {
  return [true, (await postgres({ ...options, ...login })`select true as x`)[0].x]
})

t('Login using MD5', async() => {
  return [true, (await postgres({ ...options, ...login_md5 })`select true as x`)[0].x]
})

t('Login using scram-sha-256', async() => {
  return [true, (await postgres({ ...options, ...login_scram })`select true as x`)[0].x]
})

t('Parallel connections using scram-sha-256', {
  timeout: 2
}, async() => {
  const sql = postgres({ ...options, ...login_scram })
  return [true, (await Promise.all([
    sql`select true as x, pg_sleep(0.01)`,
    sql`select true as x, pg_sleep(0.01)`,
    sql`select true as x, pg_sleep(0.01)`
  ]))[0][0].x]
})

t('Support dynamic password function', async() => {
  return [true, (await postgres({
    ...options,
    ...login_scram,
    pass: () => 'postgres_js_test_scram'
  })`select true as x`)[0].x]
})

t('Support dynamic async password function', async() => {
  return [true, (await postgres({
    ...options,
    ...login_scram,
    pass: () => Promise.resolve('postgres_js_test_scram')
  })`select true as x`)[0].x]
})

t('Connection ended promise', async() => {
  const sql = postgres(options)

  await sql.end()

  return [undefined, await sql.end()]
})

t('Connection ended timeout', async() => {
  const sql = postgres(options)

  await sql.end({ timeout: 10 })

  return [undefined, await sql.end()]
})

t('Connection ended error', async() => {
  const sql = postgres(options)
  await sql.end()
  return ['CONNECTION_ENDED', (await sql``.catch(x => x.code))]
})

t('Connection end does not cancel query', async() => {
  const sql = postgres(options)

  const promise = sql`select 1 as x`.execute()

  await sql.end()

  return [1, (await promise)[0].x]
})

t('Connection destroyed', async() => {
  const sql = postgres(options)
  process.nextTick(() => sql.end({ timeout: 0 }))
  return ['CONNECTION_DESTROYED', await sql``.catch(x => x.code)]
})

t('Connection destroyed with query before', async() => {
  const sql = postgres(options)
      , error = sql`select pg_sleep(0.2)`.catch(err => err.code)

  sql.end({ timeout: 0 })
  return ['CONNECTION_DESTROYED', await error]
})

t('responds with server parameters (application_name)', async() =>
  ['postgres.js', await new Promise((resolve, reject) => postgres({
    ...options,
    onparameter: (k, v) => k === 'application_name' && resolve(v)
  })`select 1`.catch(reject))]
)

t('has server parameters', async() => {
  return ['postgres.js', (await sql`select 1`.then(() => sql.parameters.application_name))]
})

t('connection parameters', async() => {
  const sql = postgres({
    ...options,
    connection: {
      'some.var': 'yay'
    }
  })

  return ['yay', (await sql`select current_setting('some.var') as x`)[0].x]
})

t('Unix socket', async() => {
  const sql = postgres({
    ...options,
    host: process.env.PGSOCKET || '/tmp'
  })

  return [1, (await sql`select 1 as x`)[0].x]
})

t('connect_timeout', { timeout: 20 }, async() => {
  const connect_timeout = 0.2
  const server = net.createServer()
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const sql = postgres({ port: server.address().port, host: '127.0.0.1', connect_timeout })
  const start = Date.now()
  let end
  await sql`select 1`.catch((e) => {
    if (e.code !== 'CONNECT_TIMEOUT')
      throw e
    end = Date.now()
  })
  server.close()
  return [connect_timeout, Math.round((end - start) / 100) / 10]
})

t('connect_timeout throws proper error', async() => [
  'CONNECT_TIMEOUT',
  await postgres({
    ...options,
    ...login_scram,
    connect_timeout: 0.001
  })`select 1`.catch(e => e.code)
])

t('connect_timeout error message includes host:port', { timeout: 20 }, async() => {
  const connect_timeout = 0.2
  const server = net.createServer()
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const sql = postgres({ port: server.address().port, host: '127.0.0.1', connect_timeout })
  const port = server.address().port
  let err
  await sql`select 1`.catch((e) => {
    if (e.code !== 'CONNECT_TIMEOUT')
      throw e
    err = e.message
  })
  server.close()
  return [['write CONNECT_TIMEOUT 127.0.0.1:', port].join(''), err]
})

t('requests works after single connect_timeout', async() => {
  let first = true

  const sql = postgres({
    ...options,
    ...login_scram,
    connect_timeout: { valueOf() { return first ? (first = false, 0.0001) : 1 } }
  })

  return [
    'CONNECT_TIMEOUT,,1',
    [
      await sql`select 1 as x`.then(() => 'success', x => x.code),
      await delay(10),
      (await sql`select 1 as x`)[0].x
    ].join(',')
  ]
})

t('Catches connection config errors', async() => {
  const sql = postgres({ ...options, user: { toString: () => { throw new Error('wat') } }, database: 'prut' })

  return [
    'wat',
    await sql`select 1`.catch((e) => e.message)
  ]
})

t('Catches connection config errors with end', async() => {
  const sql = postgres({ ...options, user: { toString: () => { throw new Error('wat') } }, database: 'prut' })

  return [
    'wat',
    await sql`select 1`.catch((e) => e.message),
    await sql.end()
  ]
})

t('Multiple hosts', {
  timeout: 1
}, async() => {
  const s1 = postgres({ idle_timeout })
      , s2 = postgres({ idle_timeout, port: 5433 })
      , sql = postgres('postgres://localhost:5432,localhost:5433', { idle_timeout, max: 1 })
      , result = []

  const id1 = (await s1`select system_identifier as x from pg_control_system()`)[0].x
  const id2 = (await s2`select system_identifier as x from pg_control_system()`)[0].x

  const x1 = await sql`select 1`
  result.push((await sql`select system_identifier as x from pg_control_system()`)[0].x)
  await s1`select pg_terminate_backend(${ x1.state.pid }::int)`
  await delay(50)

  const x2 = await sql`select 1`
  result.push((await sql`select system_identifier as x from pg_control_system()`)[0].x)
  await s2`select pg_terminate_backend(${ x2.state.pid }::int)`
  await delay(50)

  result.push((await sql`select system_identifier as x from pg_control_system()`)[0].x)

  return [[id1, id2, id1].join(','), result.join(',')]
})

t('multiple queries before connect', async() => {
  const sql = postgres({ ...options, max: 2 })
  const xs = await Promise.all([
    sql`select 1 as x`,
    sql`select 2 as x`,
    sql`select 3 as x`,
    sql`select 4 as x`
  ])

  return [
    '1,2,3,4',
    xs.map(x => x[0].x).join()
  ]
})

t('Custom socket', {}, async() => {
  let result
  const sql = postgres({
    socket: () => new Promise((resolve, reject) => {
      const socket = new net.Socket()
      socket.connect(5432)
      socket.once('data', x => result = x[0])
      socket.on('error', reject)
      socket.on('connect', () => resolve(socket))
    }),
    idle_timeout
  })

  await sql`select 1`

  return [
    result,
    82
  ]
})

t('Ensure drain only dequeues if ready', async() => {
  const sql = postgres(options)

  const res = await Promise.all([
    sql.unsafe('SELECT 0+$1 --' + '.'.repeat(100000), [1]),
    sql.unsafe('SELECT 0+$1+$2+$3', [1, 2, 3])
  ])

  return [res.length, 2]
})

t('max: undefined uses the default', async() => {
  const sql = postgres({ ...options, max: undefined })
  return [10, sql.options.max, await sql.end()]
})

t('onnotice: false silences notices', async() => {
  const sql = postgres({ ...options, onnotice: false })
  const log = console.log
  let logged = false
  console.log = () => logged = true
  try {
    await sql`do $$ begin raise notice 'hi'; end $$`
  } finally {
    console.log = log
  }
  return [false, logged, await sql.end()]
})

t('Multiple hosts errors when all hosts are down', { timeout: 10 }, async() => {
  const sql = postgres({ ...options, host: ['localhost', 'localhost'], port: [1, 2], connect_timeout: 1 })
  return ['ECONNREFUSED', await sql`select 1`.catch(e => e.code)]
})

t('Multiple hosts continues to next host after connect timeout', { timeout: 10 }, async() => {
  const server = net.createServer()
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const sql = postgres({ ...options, host: ['127.0.0.1', 'localhost'], port: [server.address().port, 5432], connect_timeout: 1 })
  const x = (await sql`select 1 as x`)[0].x
  server.close()
  await sql.end()
  return [1, x]
})

t('prefer-standby connects to the primary when the standby host is down', { timeout: 10 }, async() => {
  const sql = postgres({
    ...options,
    host: ['localhost', 'localhost'],
    port: [1, 5432],
    target_session_attrs: 'prefer-standby',
    connect_timeout: 1
  })
  const x = (await sql`select 1 as x`)[0].x
  await sql.end()
  return [1, x]
})

t('prefer-standby connects to a primary when no host is a standby', { timeout: 10 }, async() => {
  const sql = postgres({ idle_timeout, max: 1, host: ['localhost', 'localhost'], port: [5432, 5433], target_session_attrs: 'prefer-standby' })
  const x = (await sql`select 1 as x`)[0].x
  await sql.end()
  return [1, x]
})

t('target_session_attrs standby errors when no host is a standby', { timeout: 10 }, async() => {
  const sql = postgres({ idle_timeout, max: 1, host: ['localhost', 'localhost'], port: [5432, 5433], target_session_attrs: 'standby' })
  return ['CONNECTION_DESTROYED', await sql`select 1`.catch(e => e.code)]
})

t('Multiple hosts rejects within connect_timeout × hosts when every host times out', { timeout: 10 }, async() => {
  const connect_timeout = 0.3
  const a = await listening(net.createServer())
  const b = await listening(net.createServer())
  const host = ['127.0.0.1', '127.0.0.1']
  const port = [a.address().port, b.address().port]
  const sql = postgres({ ...options, host, port, connect_timeout })

  const start = Date.now()
  const code = await sql`select 1`.catch(e => e.code)
  const elapsed = (Date.now() - start) / 1000

  a.close()
  b.close()
  await sql.end()

  return ['CONNECT_TIMEOUT,true', code + ',' + (elapsed < connect_timeout * host.length + 1)]
})

t('prefer-standby tries every host for a standby before accepting a primary', { timeout: 10 }, async() => {
  let probe = 0
  const server = await listening(net.createServer(socket => (probe++, socket.destroy())))
  const sql = postgres({
    ...options,
    host: ['localhost', '127.0.0.1'],
    port: [5432, server.address().port],
    target_session_attrs: 'prefer-standby'
  })

  const x = (await sql`select 1 as x`)[0].x
  server.close()
  await sql.end()

  return ['1,1', [x, probe].join(',')]
})

const backendMessage = (type, body) => {
  const header = Buffer.alloc(5)
  header.write(type)
  header.writeInt32BE(body.length + 4, 1)
  return Buffer.concat([header, body])
}

const errorResponse = (severity, code) => backendMessage('E', Buffer.from('S' + severity + '\0V' + severity + '\0C' + code + '\0M' + code + '\0\0'))

const authenticated = Buffer.concat([
  backendMessage('R', Buffer.alloc(4)),
  backendMessage('Z', Buffer.from('I'))
])

t('Query runs on a new connection if the backend dies while fetching array types', async() => {
  let killed = false
    , unhandled = 0

  const onunhandled = () => unhandled++
  process.on('unhandledRejection', onunhandled)

  const proxy = net.createServer(client => {
    const server = net.connect(5432, 'localhost')
    client.on('data', x => {
      if (!killed && x.includes('typarray')) {
        killed = true
        server.destroy()
        return client.end(errorResponse('FATAL', '57P01'))
      }
      server.write(x)
    })
    server.on('data', x => client.writable && client.write(x))
    client.on('error', () => server.destroy())
    server.on('error', () => client.destroy())
    client.on('close', () => server.destroy())
  })

  await new Promise(r => proxy.listen(0, 'localhost', r))
  const sql = postgres({ ...options, host: 'localhost', port: proxy.address().port })
  const x = await sql`select 1 as x`.then(([x]) => x.x, e => e.code)
  await sql.end()
  proxy.close()
  process.off('unhandledRejection', onunhandled)

  return ['1,0', [x, unhandled].join(',')]
})

t('Clean closes during startup reject queries and reserves instead of reconnecting forever', async() => {
  let attempts = 0

  const server = net.createServer(socket => (attempts++, socket.end()))
  await new Promise(r => server.listen(0, 'localhost', r))
  const sql = postgres({ ...options, max: 2, host: 'localhost', port: server.address().port })
  const codes = await Promise.all([
    sql`select 1`.catch(e => e.code),
    sql`select 2`.catch(e => e.code),
    sql.reserve().catch(e => e.code)
  ])
  await sql.end()
  server.close()

  return ['CONNECTION_CLOSED,CONNECTION_CLOSED,CONNECTION_CLOSED,true', [...codes, attempts < 10].join(',')]
})

t('A query refused with a FATAL error rejects with the peer error instead of reconnecting forever', async() => {
  let attempts = 0
    , unhandled = 0

  const onunhandled = () => unhandled++
  process.on('unhandledRejection', onunhandled)

  const server = net.createServer(socket => {
    let started = false
    attempts++
    socket.on('error', () => socket.destroy())
    socket.on('data', () => started
      ? socket.end(errorResponse('FATAL', '08P01'))
      : (started = true, socket.write(authenticated))
    )
  })

  await new Promise(r => server.listen(0, 'localhost', r))
  const sql = postgres({ ...options, host: 'localhost', port: server.address().port })
  const code = await sql`select 1`.catch(e => e.code)
  await sql.end()
  server.close()
  process.off('unhandledRejection', onunhandled)

  return ['08P01,true,0', [code, attempts < 10, unhandled].join(',')]
})

t('Failed array type fetch on a live connection is not an unhandled rejection', async() => {
  let unhandled = 0

  const onunhandled = () => unhandled++
  process.on('unhandledRejection', onunhandled)

  const server = net.createServer(socket => {
    socket.on('error', () => socket.destroy())
    socket.on('data', x => x.includes('typarray')
      ? socket.write(Buffer.concat([errorResponse('ERROR', '57014'), backendMessage('Z', Buffer.from('I'))]))
      : x[0] === 88
        ? socket.end()
        : socket.write(authenticated)
    )
  })

  await new Promise(r => server.listen(0, 'localhost', r))
  const sql = postgres({ ...options, host: 'localhost', port: server.address().port })
  await sql`select 1`.catch(() => null)
  await sql.end()
  server.close()
  process.off('unhandledRejection', onunhandled)

  return [0, unhandled]
})

t('end() completes after the backend is terminated mid-query', { timeout: 5 }, async() => {
  const sql = postgres({ ...options, max: 1 })
      , killer = postgres(options)
  const [{ pid }] = await sql`select pg_backend_pid() as pid`
  const query = sql`select pg_sleep(1)`.catch(e => e)
  await delay(10)
  await killer`select pg_terminate_backend(${ pid })`
  await killer.end()
  const error = await query
  const start = Date.now()
  await sql.end()
  return ['true,true', [error instanceof Error, Date.now() - start < 1000].join()]
})

t('Connection end cancels a pending socket factory', async() => {
  let release
    , started
    , closes = 0

  const connecting = new Promise(r => started = r)
      , socket = new net.Socket()
      , application_name = 'postgres.js end socket factory ' + crypto.randomBytes(4).toString('hex')
      , client = postgres({
        ...options,
        connection: { application_name },
        onclose: () => closes++,
        socket: ({ port, host }) => new Promise((resolve, reject) => {
          release = resolve
          socket.on('error', reject)
          socket.connect(port[0], host[0], started)
        })
      })
      , query = client`select 1`.catch(x => x.code)

  try {
    await connecting
    await client.end({ timeout: 0 })
    release(socket)
    await delay(200)
    const [{ count }] = await sql`select count(*)::int as count from pg_stat_activity where application_name = ${ application_name }`
    return ['CONNECTION_DESTROYED,0,true,0', [await query, count, socket.destroyed, closes].join()]
  } finally {
    socket.destroy()
    await client.end({ timeout: 0 })
    await sql`select pg_terminate_backend(pid) from pg_stat_activity where application_name = ${ application_name }`
  }
})

t('Connection end stops a listen connection that is reconnecting', async() => {
  const application_name = 'postgres.js end reconnect ' + crypto.randomBytes(4).toString('hex')
      , client = postgres({ ...options, connection: { application_name } })

  try {
    const { state: { pid } } = await client.listen('end_reconnect', () => 0)
    await sql`select pg_terminate_backend(${ pid })`
    await delay(0)
    await client.end()
    await delay(400)
    const [{ count }] = await sql`select count(*)::int as count from pg_stat_activity where application_name = ${ application_name }`
    return [0, count]
  } finally {
    await client.end({ timeout: 0 })
    await sql`select pg_terminate_backend(pid) from pg_stat_activity where application_name = ${ application_name }`
  }
})

t('Connection end cancels the first listen attempt', async() => {
  const server = net.createServer(socket => socket.resume())
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const socket = new net.Socket()
  const closed = new Promise(r => socket.once('close', r))
  const sql = postgres({ ...options, connect_timeout: 30, socket: () => socket.connect(server.address().port, '127.0.0.1') })
  const listening = sql.listen('end_connecting', () => {}).catch(x => x.code)
  await sql.end()
  await closed
  server.close()
  return ['CONNECTION_DESTROYED', await listening]
})

t('Cancel query while its connection is opening', async() => {
  let open
  const opened = new Promise(r => open = r)
  const sql = postgres({
    ...options,
    socket: async({ host: [host], port: [port] }) => {
      await opened
      return new Promise((resolve, reject) => {
        const socket = new net.Socket()
        socket.connect(port, host)
        socket.on('error', reject)
        socket.on('connect', () => resolve(socket))
      })
    }
  })
  const query = sql`select 1 as x`
  const error = query.catch(x => x)
  await delay(10)
  query.cancel()
  const next = sql`select 2 as x`.execute()
  open()
  const [{ x }] = await next
  return ['57014,2', (await error).code + ',' + x, await sql.end()]
})

t('A query cancelled while its connection starts up leaves the connection in the pool (#1266)', { timeout: 10 }, async() => {
  const results = []
  for (const [phase, o] of [['auth', {}], ['types', {}], ['auth', { fetch_types: false }]]) {
    const held = []
    let holding = phase === 'auth'

    const proxy = net.createServer(client => {
      const server = net.connect(options.port || 5432, 'localhost')
      client.on('data', x => (phase === 'types' && x.includes('typarray') && (holding = true), server.write(x)))
      server.on('data', x => holding ? held.push(x) : client.write(x))
      client.on('error', () => server.destroy())
      server.on('error', () => client.destroy())
      client.on('close', () => server.destroy())
      server.on('close', () => client.destroy())
      proxy.release = () => (holding = false, held.splice(0).forEach(x => client.write(x)))
    })

    await new Promise(r => proxy.listen(0, 'localhost', r))
    const sql = postgres({ ...options, ...o, host: 'localhost', port: proxy.address().port, max: 1 })
        , query = sql`select 1 as x`
        , outcome = query.then(() => 'ran', x => x.code)

    await delay(100)
    await query.cancel()
    proxy.release()
    const started = performance.now()
    const [{ x }] = await sql`select 2 as x`
    results.push([phase, ['57014', 'ran'].includes(await outcome), x, performance.now() - started < 2000].join(' '))
    await sql.end({ timeout: 0 })
    proxy.close()
  }
  return ['auth true 2 true,types true 2 true,auth true 2 true', results.join()]
})

t('sql.begin works with max_pipeline: 0 and max: 1 (#1264)', async() => {
  const sql = postgres({ ...options, max: 1, max_pipeline: 0 })
  const x = await sql.begin(sql => sql`select 1 as x`).then(x => x[0].x, e => e.code)
  const y = await sql.begin(async sql => {
    await sql`select 1`
    return (await sql`select 2 as y`)[0].y
  }).then(x => x, e => e.code)
  return ['1 2', x + ' ' + y, await sql.end()]
})

t('onread: false reads through the socket stream instead of a shared buffer', async() => {
  const sql = postgres({ ...options, onread: false, max: 1 })
  const [{ x }] = await sql`select 1 as x`
  const rows = await sql`select generate_series(1, 20000) as n`
  return ['1,20000', [x, rows.length].join(), await sql.end()]
})

t('sql.stats is current, not a snapshot from creation', async() => {
  const sql = postgres({ ...options, max: 2 })
  const before = sql.stats.connections
  const queries = Promise.all([sql`select pg_sleep(0.2)`, sql`select pg_sleep(0.2)`])
  await delay(100)
  const during = sql.stats
  await queries
  const after = sql.stats
  return ['0 2 0 2', [before, during.connections, during.idle, after.idle].join(' '), await sql.end()]
})


t('A socket error without a close rejects the query in flight instead of hanging (#1246, #1089)', { timeout: 5 }, async() => {
  let raw
  const sql = postgres({ ...options, max: 1, socket: () => raw = net.connect(options.port || 5432, options.host || 'localhost') })
  await sql`select 1`
  const q = sql`select pg_sleep(2)`.then(() => 'done', e => e.code)
  await delay(100)
  raw.emit('error', new Error('half open'))
  const start = Date.now()
  const result = await q
  return ['CONNECTION_CLOSED true 1', result + ' ' + (Date.now() - start < 1000) + ' ' + (await sql`select 1 as x`)[0].x, await sql.end()]
})

t('Queries keep working after the backend dies under a burst of pipelined writes (#1250)', { timeout: 10 }, async() => {
  const sql = postgres({ ...options, max: 1 })
  const [{ pid }] = await sql`select pg_backend_pid() as pid`
  const burst = Promise.all([...Array(200)].map((_, i) => sql`select ${ i }::int as x`.then(() => 'ok', e => e.code)))
  const other = postgres({ ...options, max: 1 })
  await other`select pg_terminate_backend(${ pid })`
  const settled = await burst
  while ((await other`select 1 from pg_stat_activity where pid = ${ pid }`).length)
    await delay(10)
  await delay(50)
  await other.end()
  const [{ x }] = await sql`select 1 as x`
  return [true, settled.length === 200 && x === 1, await sql.end()]
})

function lyingServer(final) {
  const i32 = n => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b }
      , msg = (t, body) => Buffer.concat([Buffer.from(t), i32(body.length + 4), body])
      , z = x => Buffer.from(x + '\0')
      , salt = Buffer.from('saltsalt').toString('base64')
  const server = net.createServer(s => {
    let buf = Buffer.alloc(0)
      , started = false
      , nonce = null
    s.on('error', () => {})
    s.on('data', d => {
      buf = Buffer.concat([buf, d])
      let more = true
      while (more)
        more = started ? message() : startup()
    })

    function startup() {
      if (buf.length < 8 || buf.length < buf.readInt32BE(0))
        return false

      const code = buf.readInt32BE(4)
      buf = buf.subarray(buf.readInt32BE(0))
      code === 80877103 ? s.write('N') : (started = true, s.write(msg('R', Buffer.concat([i32(10), z('SCRAM-SHA-256'), z('')]))))
      return true
    }

    function message() {
      if (buf.length < 5 || buf.length < buf.readInt32BE(1) + 1)
        return false

      const type = String.fromCharCode(buf[0])
          , body = buf.subarray(5, buf.readInt32BE(1) + 1)
      buf = buf.subarray(buf.readInt32BE(1) + 1)
      if (type === 'p' && !nonce) {
        nonce = /r=([^,\0]+)/.exec(body.toString())[1]
        s.write(msg('R', Buffer.concat([i32(11), Buffer.from('r=' + nonce + 'srv,s=' + salt + ',i=4096')])))
      } else if (type === 'p') {
        s.write(Buffer.concat([
          ...(final ? [msg('R', Buffer.concat([i32(12), Buffer.from('v=' + Buffer.from('not the signature').toString('base64'))]))] : []),
          msg('R', i32(0)),
          msg('K', Buffer.concat([i32(1), i32(2)])),
          msg('Z', Buffer.from('I'))
        ]))
      } else if (type === 'X') {
        s.end()
      }
      return true
    }
  })
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)))
}

t('A server whose SCRAM signature is wrong is not trusted', async() => {
  const server = await lyingServer(true)
  const sql = postgres({ host: '127.0.0.1', port: server.address().port, user: 'u', pass: 'p', db: 'd', fetch_types: false, max: 1 })
  const code = await sql`select 1`.then(() => 'connected', e => e.code)
  await sql.end({ timeout: 0 })
  server.close()
  return ['SASL_SIGNATURE_MISMATCH', code]
})

t('A server that ends SCRAM without its signature is not trusted', async() => {
  const server = await lyingServer(false)
  const sql = postgres({ host: '127.0.0.1', port: server.address().port, user: 'u', pass: 'p', db: 'd', fetch_types: false, max: 1 })
  const code = await sql`select 1`.then(() => 'connected', e => e.code)
  await sql.end({ timeout: 0 })
  server.close()
  return ['SASL_SIGNATURE_MISMATCH', code]
})

t('A cancel request on a TLS connection is sent over TLS', { timeout: 10 }, async() => {
  const firsts = []
  const server = net.createServer(c => {
    const up = net.connect(options.port || 5432, options.host || 'localhost')
    let first = true
    c.on('data', d => (first && firsts.push(d.readInt32BE(4)), first = false, up.write(d)))
    up.on('data', d => c.write(d))
    up.on('error', () => c.destroy())
    c.on('error', () => up.destroy())
    up.on('close', () => c.destroy())
    c.on('close', () => up.destroy())
  })
  await new Promise(r => server.listen(0, 'localhost', r))
  const sql = postgres({ ...options, host: 'localhost', port: server.address().port, ssl: 'require', max: 1 })
  await sql`select 1`
  const q = sql`select pg_sleep(2)`
  setTimeout(() => q.cancel(), 200)
  const code = await q.then(() => 'not cancelled', e => e.code)
  await sql.end()
  server.close()
  return ['57014 80877103,80877103', code + ' ' + firsts.join()]
})

t('sql.close() lets a running transaction and a reserved connection finish first', async() => {
  const sql = postgres(options)
  await sql`create table test (a int)`
  const tx = sql.begin(async sql => {
    await sql`insert into test values (1)`
    await delay(200)
    await sql`insert into test values (2)`
    return 'committed'
  }).catch(e => e.code)
  await delay(50)
  const closed = sql.close()
  const result = await tx
  await closed
  const [{ n }] = await sql`select count(*)::int as n from test`
  const reserved = await sql.reserve()
  await reserved`select 1`
  const closing = sql.close()
  const after = await reserved`select 1 as x`.then(x => x[0].x, e => e.code)
  reserved.release()
  await closing
  return ['committed 2 1', result + ' ' + n + ' ' + after, await sql`drop table test`, await sql.end()]
})

t('With several hosts every new connection tries the first host first, as in v3', async() => {
  const hosts = 'localhost:' + (options.port || 5432) + ',localhost:5433'
  const sql = postgres({ ...options, user: 'postgres', pass: '', db: 'postgres', host: hosts, max: 3 })
  const ports = []
  const reserved = []
  for (let i = 0; i < 3; i++) {
    const r = await sql.reserve()
    reserved.push(r)
    ports.push((await r`select inet_server_port() as p`)[0].p)
  }
  reserved.forEach(r => r.release())
  const first = options.port || 5432
  return [[first, first, first].join(), ports.join(), await sql.end()]
})

t('A query waiting while new connections fail and the only one is reserved is rejected instead of waiting forever', { timeout: 10 }, async() => {
  const admin = postgres({ ...options, user: 'postgres', pass: '', max: 1 })
  await admin`drop role if exists postgres_js_test_limit`
  await admin`create role postgres_js_test_limit login connection limit 1`
  const sql = postgres({ ...options, host: process.env.PGSOCKET || '/tmp', user: 'postgres_js_test_limit', pass: '', max: 2, connect_timeout: 1 })
  const reserved = await sql.reserve()
  const code = await sql`select 1`.then(() => 'ran', e => e.code)
  reserved.release()
  await sql.end()
  await admin`drop role postgres_js_test_limit`
  return ['53300', code, await admin.end()]
})

t('Falsy connection parameters are left out of the startup message, as in v3', async() => {
  const sql = postgres({ ...options, connection: { search_path: '' } })
  const [{ search_path }] = await sql`show search_path`
  return ['"$user", public', search_path, await sql.end()]
})

t('sql.options.parsers and sql.options.serializers are objects keyed by oid', async() => {
  const sql = postgres(options)
  const { parsers, serializers } = sql.options
  return ['5 true true', [parsers[23]('5'), Object.keys(parsers).length > 0, typeof serializers[23] === 'function'].join(' '), await sql.end()]
})

t('Queries and transactions fail fast with the connection error while connections keep failing', async() => {
  const sql = postgres({ ...options, port: 1, max: 2 })
  const times = []
  for (let i = 0; i < 4; i++) {
    const start = Date.now()
    times.push(await sql`select 1`.catch(e => e.code), Date.now() - start)
  }
  for (let i = 0; i < 3; i++) {
    const start = Date.now()
    times.push(await sql.begin(sql => sql`select 1`).catch(e => e.code), Date.now() - start)
  }
  const codes = times.filter((x, i) => i % 2 === 0)
  const slow = times.filter((x, i) => i % 2 === 1 && i > 3 && x > 200)
  await sql.end()
  return ['true x7, slow 0', codes.every(x => x === 'ECONNREFUSED') + ' x' + codes.length + ', slow ' + slow.length]
})

t('Errors from fast failures are separate objects for each query', async() => {
  const sql = postgres({ ...options, port: 1 })
  const errors = []
  for (let i = 0; i < 4; i++)
    errors.push(await sql.unsafe('select ' + i).catch(e => e))
  await sql.end()
  return [
    'true',
    String(new Set(errors).size === errors.length
      && errors.every((e, i) => e.query === 'select ' + i && typeof e.stack === 'string' && e.code === 'ECONNREFUSED'))
  ]
})

t('A failed connection attempt does not give up on queries a connection still loading types will serve', { timeout: 10 }, async() => {
  const admin = postgres({ ...options, user: 'postgres', pass: '', max: 1 })
  await admin`drop role if exists postgres_js_test_loading`
  await admin`create role postgres_js_test_loading login connection limit 1`
  const sql = postgres({ ...options, host: process.env.PGSOCKET || '/tmp', user: 'postgres_js_test_loading', pass: '', max: 2, connect_timeout: 1 })
  const results = await Promise.all([
    sql`select 1 as x`.then(x => x[0].x, e => e.code),
    sql.reserve().then(r => (r.release(), 'reserved'), e => e.code)
  ])
  await sql.end()
  await admin`drop role postgres_js_test_loading`
  return ['1,reserved', results.join(), await admin.end()]
})

t('Connections refused for too many connections are retried until connect_timeout', { timeout: 10 }, async() => {
  const admin = postgres({ ...options, user: 'postgres', pass: '', max: 1 })
  await admin`drop role if exists postgres_js_test_burst`
  await admin`create role postgres_js_test_burst login connection limit 0`
  const sql = postgres({ ...options, host: process.env.PGSOCKET || '/tmp', user: 'postgres_js_test_burst', pass: '', max: 4, connect_timeout: 5 })
  const results = Promise.all(Array.from({ length: 4 }, (_, i) => sql`select ${ i }::int as x`.then(x => x[0].x, e => e.code)))
  await delay(300)
  await admin`alter role postgres_js_test_burst connection limit 1`
  const got = (await results).join()
  await sql.end()
  await admin`drop role postgres_js_test_burst`
  return ['0,1,2,3', got, await admin.end()]
})

t('Connections refused for too many connections reject once connect_timeout has passed', { timeout: 10 }, async() => {
  const admin = postgres({ ...options, user: 'postgres', pass: '', max: 1 })
  await admin`drop role if exists postgres_js_test_none`
  await admin`create role postgres_js_test_none login connection limit 0`
  const sql = postgres({ ...options, host: process.env.PGSOCKET || '/tmp', user: 'postgres_js_test_none', pass: '', max: 2, connect_timeout: 0.5 })
  const start = Date.now()
  const code = await sql`select 1`.then(() => 'ran', e => e.code)
  const waited = Date.now() - start
  await sql.end()
  await admin`drop role postgres_js_test_none`
  return ['53300 true', code + ' ' + (waited >= 400 && waited < 4000), await admin.end()]
})

t('unref_sockets lets the process exit while connections are idle', { timeout: 20 }, async() => {
  const script = idle => [
    'const postgres = (await import(' + JSON.stringify(new URL('../src/index.js', import.meta.url).href) + ')).default',
    'const sql = postgres(' + JSON.stringify({ ...options, idle_timeout: 60, unref_sockets: idle }) + ')',
    'await sql`select 1`',
    'await sql.begin(sql => sql`select 2`)',
    'console.log("done")'
  ].join('\n')
  const [unref, kept] = await Promise.all([exits(script(true)), exits(script(false))])
  return ['done true false', unref.out + ' ' + unref.exited + ' ' + kept.exited]
})

t('sql and reserved connections are async disposable', async() => {
  const sql = postgres(options)
  const reserved = await sql.reserve()
  await reserved`select 1`
  await reserved[Symbol.asyncDispose]()
  const released = await reserved`select 1`.then(() => 'ran', e => e.code)
  await sql[Symbol.asyncDispose]()
  return ['UNSAFE_TRANSACTION CONNECTION_ENDED', released + ' ' + await sql`select 1`.then(() => 'ran', e => e.code)]
})

async function exits(source) {
  const { spawn } = await import('child_process')
      , fs = await import('fs')
      , os = await import('os')
      , path = await import('path')
      , file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'unref-')), 'x.mjs')
  fs.writeFileSync(file, source)
  const child = spawn(process.execPath, typeof Deno !== 'undefined' ? ['run', '-A', file] : [file], { env: process.env })
  let out = ''
  child.stdout.on('data', x => out += x)
  const exited = await new Promise(r => {
    const timer = setTimeout(() => (child.kill(), r(false)), 5000)
    child.on('exit', () => (clearTimeout(timer), r(true)))
  })
  fs.rmSync(path.dirname(file), { recursive: true, force: true })
  return { out: out.trim(), exited }
}

function listening(server) {
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)))
}

t('user can be a function, called for each connection', async() => {
  let calls = 0
  const sql = postgres({ ...options, max: 2, user: async() => (calls++, login.user) })
  const users = await Promise.all([sql`select current_user as u, pg_sleep(0.05)`, sql`select current_user as u, pg_sleep(0.05)`])
  return [login.user + ' ' + login.user + ' 2', users.map(x => x[0].u).join(' ') + ' ' + calls, await sql.end()]
})

t('min keeps that many connections open once the pool is used', { timeout: 10 }, async() => {
  const sql = postgres({ ...options, max: 4, min: 2, idle_timeout: 0.2 })
  const before = sql.stats.connections
  await sql`select 1`
  await delay(100)
  const opened = sql.stats.connections
  await Promise.all([1, 2, 3, 4].map(() => sql`select pg_sleep(0.1)`))
  const busy = sql.stats.connections
  await delay(800)
  return ['0 2 4 2', [before, opened, busy, sql.stats.connections].join(' '), await sql.end()]
})

t('One query on a cold pool opens one connection', async() => {
  const sql = postgres({ ...options, max: 4 })
  await sql`select 1`
  await delay(100)
  return [1, sql.stats.connections, await sql.end()]
})

t('A password from PGPASSFILE, as libpq reads it (#964)', async() => {
  const lines = ['# comment', 'otherhost:*:*:*:wrong', '*:*:*:' + login_md5.user + ':' + login_md5.pass.replace(/:/g, '\\:')]
  return ['1', await passfile(lines.join('\n'), 0o600, sql => sql`select 1 as x`.then(x => String(x[0].x)))]
})

t('A password file readable by others is ignored, as in libpq', async() => [
  '28P01',
  await passfile('*:*:*:' + login_md5.user + ':' + login_md5.pass, 0o644, sql => sql`select 1`.then(() => 'ran', e => e.code))
])

async function passfile(content, mode, fn) {
  const fs = await import('fs')
      , os = await import('os')
      , path = await import('path')
      , file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pgpass-')), 'pgpass')
      , before = process.env.PGPASSFILE
  fs.writeFileSync(file, content)
  fs.chmodSync(file, mode)
  process.env.PGPASSFILE = file
  const sql = postgres({ ...options, user: login_md5.user, pass: undefined })
  try {
    return await fn(sql)
  } finally {
    before === undefined ? delete process.env.PGPASSFILE : process.env.PGPASSFILE = before
    await sql.end()
    fs.rmSync(path.dirname(file), { recursive: true, force: true })
  }
}

t('queue_timeout rejects a query that waits too long for a connection, without sending it', { timeout: 10 }, async() => {
  const sql = postgres({ ...options, max: 1, queue_timeout: 0.2 })
  const reserved = await sql.reserve()
  const start = Date.now()
  const code = await sql`select 1`.then(() => 'ran', e => e.code)
  const waited = Date.now() - start
  reserved.release()
  const after = await sql`select 1 as x`
  return ['QUEUE_TIMEOUT true 1', code + ' ' + (waited >= 150 && waited < 500) + ' ' + after[0].x, await sql.end()]
})

t('queue_timeout applies to transactions and reserves waiting for a connection', { timeout: 10 }, async() => {
  const sql = postgres({ ...options, max: 1, queue_timeout: 0.2 })
  const reserved = await sql.reserve()
  const codes = [
    await sql.begin(sql => sql`select 1`).then(() => 'ran', e => e.code),
    await sql.reserve().then(() => 'reserved', e => e.code)
  ]
  reserved.release()
  return ['QUEUE_TIMEOUT QUEUE_TIMEOUT', codes.join(' '), await sql.end()]
})

t('A query that waits less than queue_timeout runs', { timeout: 10 }, async() => {
  const sql = postgres({ ...options, max: 1, queue_timeout: 1 })
  const reserved = await sql.reserve()
  const query = sql`select 1 as x`
  setTimeout(() => reserved.release(), 200)
  return [1, (await query)[0].x, await sql.end()]
})

t('An AbortSignal removes a waiting query and cancels a running one', { timeout: 10 }, async() => {
  const sql = postgres({ ...options, max: 1 })
  const reserved = await sql.reserve()
  const waiting = sql`select 1`.signal(AbortSignal.timeout(100)).then(() => 'ran', e => e.code)
  await delay(150)
  reserved.release()
  const running = sql`select pg_sleep(2)`.signal(AbortSignal.timeout(200)).then(() => 'ran', e => e.code)
  const aborted = new AbortController()
  aborted.abort()
  const before = await sql`select 1`.signal(aborted.signal).then(() => 'ran', e => e.code)
  return ['57014 57014 57014 1', [await running, await waiting, before, (await sql`select 1 as x`)[0].x].join(' '), await sql.end()]
})

t('A parameter the server reports after startup reaches onparameter and sql.parameters', async() => {
  const seen = []
      , sql = postgres({ ...options, onparameter: (k, v) => k === 'application_name' && seen.push(v) })
  await sql`set application_name = 'renamed'`
  return ['postgres.js,renamed renamed', seen.join() + ' ' + sql.parameters.application_name, await sql.end()]
})

t('An empty query gives an empty result, simple or prepared', async() => {
  const xs = [await sql.unsafe(''), await sql.unsafe('', [], { prepare: true }), await sql.unsafe(' ; ')]
  return ['0:null,0:null,0:null', xs.map(x => x.length + ':' + x.command).join()]
})

t('A query is pipelined behind the work that should finish first, not behind a long query, unless the scheduler is off', { timeout: 20 }, async() => {
  const waited = async scheduler => {
    const sql = postgres({ ...options, max: 2, idle_timeout: 0, scheduler })
        , slow = () => sql`select pg_sleep(1) as slow`
        , quick = () => sql`select pg_sleep(0.1) as quick`
        , short = () => sql`select 1 as short`
    await Promise.all([slow(), slow()])
    await Promise.all([quick(), short()])
    const s = slow().execute()
    await delay(20)
    const q = quick().execute()
    await delay(20)
    const start = Date.now()
    await short()
    const ms = Date.now() - start
    await Promise.all([s, q])
    await sql.end()
    return ms
  }
  const [on, off] = [await waited(true), await waited(false)]
  return ['true true', (on < 500) + ' ' + (off > 800)]
})

t('An identifier that looks like many comments after start does not stall the event loop', async() => {
  const sql = postgres({ ...options, max: 2 })
      , column = 'start' + '/**/'.repeat(40) + 'x'
      , started = performance.now()
  const code = await sql`select 1 as x order by ${ sql(column) }`.then(() => 'ran', e => e.code)
  return ['42703 true', code + ' ' + (performance.now() - started < 1000), await sql.end()]
})

t('A NUL character in a startup parameter rejects instead of adding parameters (as another user)', async() => {
  const codes = []
  const attempts = [
    { database: options.db + '\0user\0postgres' },
    { user: login.user + '\0database\0postgres' },
    { connection: { application_name: 'x\0replication\0database' } }
  ]
  for (const o of attempts) {
    const sql = postgres({ ...options, ...o })
    codes.push(await sql`select current_user`.then(x => x[0].current_user, e => e.code))
    await sql.end({ timeout: 0 })
  }
  return ['NUL_CHARACTER,NUL_CHARACTER,NUL_CHARACTER', codes.join()]
})

t('A NUL character in query text is rejected by the server and leaves the connection usable', async() => {
  const sql = postgres({ ...options, max: 1 })
  const codes = [
    await sql`select 1 as ${ sql('x\0y') }`.then(() => 'ran', e => e.code),
    await sql.unsafe('select 1 \0').then(() => 'ran', e => e.code)
  ]
  const [{ x }] = await sql`select 1 as x`
  return ['08P01 08P01 1', codes.join(' ') + ' ' + x, await sql.end()]
})
