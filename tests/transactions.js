import { t } from './test.js'
import { postgres, sql, options, delay, idle_timeout } from './setup.js'

t('Throws on illegal transactions', async() => {
  const sql = postgres({ ...options, max: 2, fetch_types: false })
  const error = await sql`begin`.catch(e => e)
  return [
    error.code,
    'UNSAFE_TRANSACTION'
  ]
})

t('Transaction throws', async() => {
  await sql`create table test (a int)`
  return ['22P02', await sql.begin(async sql => {
    await sql`insert into test values(1)`
    await sql`insert into test values('hej')`
  }).catch(x => x.code), await sql`drop table test`]
})

t('Transaction rolls back', async() => {
  await sql`create table test (a int)`
  await sql.begin(async sql => {
    await sql`insert into test values(1)`
    await sql`insert into test values('hej')`
  }).catch(() => {})
  return [0, (await sql`select a from test`).count, await sql`drop table test`]
})

t('Transaction throws on uncaught savepoint', async() => {
  await sql`create table test (a int)`

  return ['fail', (await sql.begin(async sql => {
    await sql`insert into test values(1)`
    await sql.savepoint(async sql => {
      await sql`insert into test values(2)`
      throw new Error('fail')
    })
  }).catch((err) => err.message)), await sql`drop table test`]
})

t('Transaction throws on uncaught named savepoint', async() => {
  await sql`create table test (a int)`

  return ['fail', (await sql.begin(async sql => {
    await sql`insert into test values(1)`
    await sql.savepoit('watpoint', async sql => {
      await sql`insert into test values(2)`
      throw new Error('fail')
    })
  }).catch(() => 'fail')), await sql`drop table test`]
})

t('Transaction succeeds on caught savepoint', async() => {
  await sql`create table test (a int)`
  await sql.begin(async sql => {
    await sql`insert into test values(1)`
    await sql.savepoint(async sql => {
      await sql`insert into test values(2)`
      throw new Error('please rollback')
    }).catch(() => {})
    await sql`insert into test values(3)`
  })

  return ['2', (await sql`select count(1) from test`)[0].count, await sql`drop table test`]
})

t('Savepoint returns Result', async() => {
  let result
  await sql.begin(async sql => {
    result = await sql.savepoint(sql =>
      sql`select 1 as x`
    )
  })

  return [1, result[0].x]
})

t('Prepared transaction', async() => {
  await sql`create table test (a int)`

  await sql.begin(async sql => {
    await sql`insert into test values(1)`
    await sql.prepare('tx1')
  })

  await sql`commit prepared 'tx1'`

  return ['1', (await sql`select count(1) from test`)[0].count, await sql`drop table test`]
})

t('Transaction requests are executed implicitly', async() => {
  const sql = postgres({ debug: true, idle_timeout: 1, fetch_types: false })
  return [
    'testing',
    (await sql.begin(sql => [
      sql`select set_config('postgres_js.test', 'testing', true)`,
      sql`select current_setting('postgres_js.test') as x`
    ]))[1][0].x
  ]
})

t('Uncaught transaction request errors bubbles to transaction', async() => [
  '42703',
  (await sql.begin(sql => [
    sql`select wat`,
    sql`select current_setting('postgres_js.test') as x, ${ 1 } as a`
  ]).catch(e => e.code))
])

t('Fragments in transactions', async() => [
  true,
  (await sql.begin(sql => sql`select true as x where ${ sql`1=1` }`))[0].x
])

t('Transaction rejects with rethrown error', async() => [
  'WAT',
  await sql.begin(async sql => {
    try {
      await sql`select exception`
    } catch (ex) {
      throw new Error('WAT')
    }
  }).catch(e => e.message)
])

t('Parallel transactions', async() => {
  await sql`create table test (a int)`
  return ['11', (await Promise.all([
    sql.begin(sql => sql`select 1`),
    sql.begin(sql => sql`select 1`)
  ])).map(x => x.count).join(''), await sql`drop table test`]
})

t('Many transactions at beginning of connection', async() => {
  const sql = postgres(options)
  const xs = await Promise.all(Array.from({ length: 100 }, () => sql.begin(sql => sql`select 1`)))
  return [100, xs.length]
})

t('Transactions array', async() => {
  await sql`create table test (a int)`

  return ['11', (await sql.begin(sql => [
    sql`select 1`.then(x => x),
    sql`select 1`
  ])).map(x => x.count).join(''), await sql`drop table test`]
})

t('Transaction waits', async() => {
  await sql`create table test (a int)`
  await sql.begin(async sql => {
    await sql`insert into test values(1)`
    await sql.savepoint(async sql => {
      await sql`insert into test values(2)`
      throw new Error('please rollback')
    }).catch(() => {})
    await sql`insert into test values(3)`
  })

  return ['11', (await Promise.all([
    sql.begin(sql => sql`select 1`),
    sql.begin(sql => sql`select 1`)
  ])).map(x => x.count).join(''), await sql`drop table test`]
})

t('Helpers in Transaction', async() => {
  return ['1', (await sql.begin(async sql =>
    await sql`select ${ sql({ x: 1 }) }`
  ))[0].x]
})

t('Connection errors are caught using begin()', {
  timeout: 2
}, async() => {
  let error
  try {
    const sql = postgres({ host: 'localhost', port: 1 })

    await sql.begin(async(sql) => {
      await sql`insert into test (label, value) values (${1}, ${2})`
    })
  } catch (err) {
    error = err
  }

  return [
    true,
    error.code === 'ECONNREFUSED' ||
    error.message === 'Connection refused (os error 61)'
  ]
})

t('Throws correct error when retrying in transactions', async() => {
  await sql`create table test(x int)`
  const error = await sql.begin(sql => sql`insert into test (x) values (${ sql.typed(false, 16) })`).catch(e => e)
  return [
    error.code,
    '42804',
    sql`drop table test`
  ]
})

t('Properly throws routine error on not prepared statements in transaction', async() => {
  const { routine } = await sql.begin(sql => [
    sql`create table x (x text[])`,
    sql`insert into x(x) values (('a', 'b'))`
  ]).catch(e => e)

  return ['transformAssignedExpr', routine]
})

t('Catches type serialize errors in transactions', async() => {
  const sql = postgres({
    idle_timeout,
    types: {
      text: {
        from: 25,
        to: 25,
        parse: x => x,
        serialize: () => { throw new Error('watSerialize') }
      }
    }
  })

  return [
    'watSerialize',
    (await sql.begin(sql => (
      sql`select 1`,
      sql`select ${ 'wat' }`
    )).catch(e => e.message))
  ]
})

t('Catches type parse errors in transactions', async() => {
  const sql = postgres({
    idle_timeout,
    types: {
      text: {
        from: 25,
        to: 25,
        parse: () => { throw new Error('watParse') },
        serialize: x => x
      }
    }
  })

  return [
    'watParse',
    (await sql.begin(sql => (
      sql`select 1`,
      sql`select 'wat'`
    )).catch(e => e.message))
  ]
})

t('Prevent premature end of connection in transaction', async() => {
  const sql = postgres({ max_lifetime: 0.01, idle_timeout })
  const result = await sql.begin(async sql => {
    await sql`select 1`
    await delay(20)
    await sql`select 1`
    return 'yay'
  })


  return [
    'yay',
    result
  ]
})

t('Ensure reconnect after max_lifetime with transactions', { timeout: 5 }, async() => {
  const sql = postgres({
    max_lifetime: 0.01,
    idle_timeout,
    max: 1
  })

  let x = 0
  while (x++ < 10) await sql.begin(sql => sql`select 1 as x`)

  return [true, true]
})

t('Ensure transactions throw if connection is closed dwhile there is no query', async() => {
  const sql = postgres(options)
  const x = await sql.begin(async() => {
    setTimeout(() => sql.end({ timeout: 0 }), 10)
    await new Promise(r => setTimeout(r, 200))
    return sql`select 1`
  }).catch(x => x)
  return ['CONNECTION_CLOSED', x.code]
})

t('Does not try rollback when commit errors', async() => {
  let notice = null
  const sql = postgres({ ...options, onnotice: x => notice = x })
  await sql`create table test(x int constraint test_constraint unique deferrable initially deferred)`

  await sql.begin('isolation level serializable', async sql => {
    await sql`insert into test values(1)`
    await sql`insert into test values(1)`
  }).catch(e => e)

  return [
    notice,
    null,
    await sql`drop table test`
  ]
})

t('Transaction rejects when the server rolls back the commit', async() => {
  const sql = postgres({ ...options, max: 1 })
  let xid
  const result = await sql.begin(async sql => {
    [{ xid }] = await sql`select pg_current_xact_id()::text as xid`
    await sql`savepoint parent_marker`
    await sql.savepoint(async sql => {
      await sql`rollback to savepoint parent_marker`
      throw new Error('force')
    }).catch(() => {})
    return 'committed'
  }).then(x => x, () => 'rejected')
  const [{ status }] = await sql`select pg_xact_status(${ xid }::xid8) as status`
  return ['rejected,aborted', result + ',' + status, await sql.end()]
})

t('Caught error inside a transaction still rejects it', async() => {
  await sql`create table test (x int)`
  const result = await sql.begin(async sql => {
    await sql`insert into test values (1)`
    await sql`select 1/0`.catch(() => {})
    return 'committed'
  }).then(x => x, () => 'rejected')
  const [{ count }] = await sql`select count(*)::int from test`
  return ['rejected,0', result + ',' + count, await sql`drop table test`]
})

t('Notify inside a transaction with max 1', async() => {
  const sql = postgres({ ...options, max: 1 })
  return ['ok', await sql.begin(sql => sql.notify('test', 'x')).then(() => 'ok'), await sql.end()]
})

t('Transaction at pipeline boundary is reserved', async() => {
  const sql = postgres({ ...options, max: 2, max_pipeline: 1, fetch_types: false })
  await Promise.all([sql`select 1`, sql`select 1`])
  const inflight = [sql`select pg_sleep(0.1)`.execute(), sql`select pg_sleep(0.1)`.execute()]
  const x = await sql.begin(sql => sql`select 1 as x`).then(x => x[0].x, x => x.code)
  await Promise.all(inflight)
  return [1, x, await sql.end()]
})

t('Transaction is reserved with pipelining disabled', async() => {
  const sql = postgres({ ...options, max: 2, max_pipeline: 0, fetch_types: false })
  const x = await sql.begin(sql => sql`select 1 as x`).then(x => x[0].x, x => x.code)
  return [1, x, await sql.end()]
})

t('Query issued while BEGIN is in flight does not join the transaction', async() => {
  const sql = postgres({ ...options, max: 1, fetch_types: false })
  await sql`create table test (a int)`
  const tx = sql.begin(async sql => {
    await sql`select 1`
    throw new Error('rollback')
  }).catch(() => {})
  const insert = sql`insert into test values (1)`
  await Promise.all([tx, insert])
  return [1, (await sql`select count(*)::int as n from test`)[0].n, await sql`drop table test`, await sql.end()]
})

t('Transaction with sequential queries works with max_pipeline 0', async() => {
  const sql = postgres({ ...options, max: 4, max_pipeline: 0 })
  return ['testing', await sql.begin(async sql => {
    await sql`select set_config('postgres_js.test', 'testing', true)`
    return (await sql`select current_setting('postgres_js.test') as x`)[0].x
  }), await sql.end()]
})

t('Transaction with concurrent queries works with max_pipeline 0', async() => {
  const sql = postgres({ ...options, max: 4, max_pipeline: 0 })
  return ['testing', (await sql.begin(sql => [
    sql`select set_config('postgres_js.test', 'testing', true)`,
    sql`select current_setting('postgres_js.test') as x`
  ]))[1][0].x, await sql.end()]
})

t('Undefined value in a transaction returning an array of queries rejects', async() => {
  const sql = postgres(options)
  await sql`create table test (x int)`
  const error = await sql.begin(sql => [
    sql`insert into test values (1)`,
    sql`select ${ undefined } as x`
  ]).catch(e => e.code)
  const count = (await sql`select count(*)::int from test`)[0].count
  await sql`drop table test`
  await sql.end()
  return ['UNDEFINED_VALUE,0', [error, count].join()]
})

t('Undefined value aborts a pipelined transaction on a reserved connection', async() => {
  const sql = postgres(options)
  await sql`create table test (x int)`
  const reserved = await sql.reserve()
  const results = await Promise.all([
    reserved`begin`,
    reserved`insert into test values (1)`,
    reserved`select ${ undefined } as x`,
    reserved`insert into test values (2)`,
    reserved`commit`
  ].map(x => x.then(x => x.command, e => e.code)))
  reserved.release()
  const count = (await sql`select count(*)::int from test`)[0].count
  await sql`drop table test`
  await sql.end()
  return ['BEGIN,INSERT,UNDEFINED_VALUE,25P02,ROLLBACK,0', [...results, count].join()]
})

t('Parameter failing to serialize aborts a pipelined transaction on a reserved connection', async() => {
  const sql = postgres(options)
  await sql`create table test (x int)`
  const reserved = await sql.reserve()
  const results = await Promise.all([
    reserved`begin`,
    reserved`insert into test values (1)`,
    reserved`select ${ new Date(NaN) }::timestamptz as x`,
    reserved`insert into test values (2)`,
    reserved`commit`
  ].map(x => x.then(x => x.command, e => e.code || e.name)))
  reserved.release()
  const count = (await sql`select count(*)::int from test`)[0].count
  await sql`drop table test`
  await sql.end()
  return ['BEGIN,INSERT,RangeError,25P02,ROLLBACK,0', [...results, count].join()]
})

t('Does not reject leftover begin onclose after commit', async() => {
  const sql = postgres({ ...options, max: 1 })
  const rejections = []
  const onUnhandled = reason => rejections.push(reason)
  process.on('unhandledRejection', onUnhandled)
  try {
    await sql.begin(sql => sql`select 1`)
    await sql.end({ timeout: 0 })
    await delay(50)
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
  return [0, rejections.length]
})

t('idle_in_transaction_session_timeout rejects the transaction', { timeout: 5 }, async() => {
  const sql = postgres(options)
  const error = await sql.begin(async sql => {
    await sql`set local idle_in_transaction_session_timeout = '1s'`
    await delay(1500)
    await sql`select 1`
  }).catch(e => e)
  await sql.end()
  return ['25P03', error.code]
})

t('Transaction queries fail after its connection is gone even if the callback continues', { timeout: 5 }, async() => {
  const sql = postgres({ ...options, max: 1 })
  setTimeout(() => sql`select 1`.catch(() => {}), 1200)
  let code
  await sql.begin(async sql => {
    await sql`set local idle_in_transaction_session_timeout = '1s'`
    await delay(1500)
    code = await sql`select 'should fail'`.then(() => 'ran', e => e.code)
  }).catch(() => {})
  await delay(1000)
  await sql.end()
  return ['CONNECTION_CLOSED', code]
})

t('Disconnect rejects queued transaction queries and allows reconnect', async() => {
  const sql = postgres({ ...options, max_pipeline: 1, fetch_types: false })
  let queries

  try {
    const error = await sql.begin(sql => {
      queries = [
        sql`select pg_terminate_backend(pg_backend_pid())`.execute(),
        sql`select 1`.execute(),
        sql`select 2`.execute()
      ]
      return Promise.allSettled(queries)
    }).catch(x => x)

    const results = await Promise.allSettled(queries)
    const [{ x }] = await sql`select 1 as x`
    return [
      '57P01,rejected,rejected,rejected,1',
      [error.code, ...results.map(x => x.status), x].join(',')
    ]
  } finally {
    await sql.end({ timeout: 0 })
  }
})

t('Disconnected transaction cannot query a reused connection', async() =>
  withDisconnectedTransaction(({ sql, disconnected }) => sql.begin(async sql => {
    await sql`select set_config('postgres_js.test', 'replacement', true)`
    const result = await disconnected`select current_setting('postgres_js.test') as x`.catch(x => x)
    return ['CONNECTION_CLOSED', result.code]
  }))
)

t('Disconnected transaction cannot commit a reused connection', async() =>
  finishDisconnectedTransaction()
)

t('Disconnected transaction cannot roll back a reused connection', async() =>
  finishDisconnectedTransaction(new Error('original callback failed'))
)

function finishDisconnectedTransaction(error) {
  return withDisconnectedTransaction(({ sql, finish }) => sql.begin(async sql => {
    const [{ x: before }] = await sql`select txid_current()::text as x`
    finish(error)
    await new Promise(resolve => setImmediate(resolve))
    const [{ x: after }] = await sql`select txid_current()::text as x`
    return [before, after]
  }))
}

async function withDisconnectedTransaction(fn) {
  const pool = postgres({ ...options, fetch_types: false })
  let finish
    , ready
  const gate = new Promise((resolve, reject) => finish = error => error ? reject(error) : resolve())
  const connected = new Promise(resolve => ready = resolve)
  const failed = pool.begin(async sql => {
    const [{ pid }] = await sql`select pg_backend_pid() as pid`
    ready({ disconnected: sql, pid })
    await gate
  }).catch(x => x)

  try {
    const { disconnected, pid } = await Promise.race([connected, failed.then(error => { throw error })])
    await sql`select pg_terminate_backend(${ pid }::int)`
    await failed
    return await fn({ sql: pool, disconnected, finish })
  } finally {
    finish()
    await new Promise(resolve => setImmediate(resolve))
    await pool.end({ timeout: 0 })
  }
}

t('Savepoint names are quoted', async() => {
  await sql`create table test (a int)`
  await sql.begin(async sql => {
    await sql.savepoint('with space', sql => sql`insert into test values (1)`)
    await sql.savepoint('a";create table test_injected (a int);--', sql => sql`insert into test values (2)`)
  })
  const [{ injected }] = await sql`select to_regclass('test_injected') is not null as injected`
  return ['2 false', (await sql`select count(*)::int as n from test`)[0].n + ' ' + injected, await sql`drop table test`]
})

t('A prepared transaction name cannot close its quote', async() => {
  const name = 'tx\'; create table test_injected (a int); --'
  await sql.begin(sql => (sql.prepare(name), sql`select 1`))
  const [{ gid }] = await sql`select gid from pg_prepared_xacts where gid like 'tx%'`
  await sql.unsafe('rollback prepared \'' + gid.replace(/'/g, '\'\'') + '\'')
  const [{ injected }] = await sql`select to_regclass('test_injected') is not null as injected`
  return ['false', String(injected)]
})

t('An unsafe begin is rejected and rolled back, and the queries behind it get their own answers', async() => {
  const sql = postgres({ ...options, max: 2 })
  await sql`create table test (a int)`
  const results = await Promise.all([
    sql`begin`.then(x => x.command, e => e.code),
    sql`insert into test values (1) returning a`.then(x => x.command + ':' + x[0].a, e => e.code),
    sql`select 'third' as x`.then(x => x.command + ':' + x[0].x, e => e.code)
  ])
  const [{ n }] = await sql`select count(*)::int as n from test`
  return ['UNSAFE_TRANSACTION,INSERT:1,SELECT:third 1', results.join() + ' ' + n, await sql`drop table test`, await sql.end()]
})

t('A begin hidden behind a comment runs alone, rolls back and leaves the queries pipelined behind it alone', async() => {
  const sql = postgres({ ...options, max: 2 })
  await sql`create table test (a int)`
  const reserved = await sql.reserve()
  const results = await Promise.all([
    sql`/* hidden */ begin`.then(x => x.command, e => e.code),
    sql`insert into test values (1) returning a`.then(x => x.command, e => e.code),
    sql`select 'third' as x`.then(x => x.command, e => e.code)
  ])
  reserved.release()
  const [{ n }] = await sql`select count(*)::int as n from test`
  const after = await Promise.all([sql`select 1 as x`, sql`select 2 as x`]).then(x => x.map(r => r[0].x).join())
  return [
    'UNSAFE_TRANSACTION,INSERT,SELECT 1 1,2',
    results.join() + ' ' + n + ' ' + after,
    await sql`drop table test`,
    await sql.end()
  ]
})

t('A begin used again runs alone again, whether tagged, unsafe, prepared or not', async() => {
  const sql = postgres({ ...options, max: 2 })
  await sql`create table test (a int)`
  const begins = [
    () => sql`begin`,
    () => sql.unsafe('begin'),
    () => sql.unsafe('begin', [], { simple: false }),
    () => sql.unsafe('begin', [], { simple: false, prepare: true })
  ]
  const results = []
  for (let i = 0; i < 2; i++) {
    for (const begin of begins) {
      results.push((await Promise.all([
        begin().then(x => x.command, e => e.code),
        sql`insert into test values (1) returning a`.then(x => x.command, e => e.code)
      ])).join(':'))
    }
  }
  const [{ n }] = await sql`select count(*)::int as n from test`
  return [
    Array(8).fill('UNSAFE_TRANSACTION:INSERT').join() + ' 8',
    results.join() + ' ' + n,
    await sql`drop table test`,
    await sql.end()
  ]
})

t('A script with its own BEGIN and COMMIT in one simple query runs on the pool', async() => {
  const sql = postgres({ ...options, max: 2 })
  await sql`create table test (a int)`
  const commands = await sql.unsafe('begin; insert into test values (1); commit;').then(x => x.map(r => r.command).join())
  const after = await sql.unsafe('select 1; begin; insert into test values (2); commit').then(x => x.map(r => r.command).join())
  const [{ n }] = await sql`select count(*)::int as n from test`
  return ['BEGIN,INSERT,COMMIT SELECT,BEGIN,INSERT,COMMIT 2', commands + ' ' + after + ' ' + n, await sql`drop table test`, await sql.end()]
})

t('A query that leaves a transaction open on the pool is rejected and rolled back', async() => {
  const sql = postgres({ ...options, max: 2 })
  await sql`create table test (a int)`
  const opened = await sql.unsafe('select 1; start transaction').then(() => 'ok', e => e.code)
  for (let i = 0; i < 4; i++)
    await sql`insert into test values (${ i })`
  await sql.end()
  const check = postgres(options)
  const [{ n }] = await check`select count(*)::int as n from test`
  return ['UNSAFE_TRANSACTION 4', opened + ' ' + n, await check`drop table test`, await check.end()]
})

t('A query issued before sql.begin runs before the transaction with max: 1', async() => {
  const sql = postgres({ ...options, max: 1 })
  await sql`create table test (a int)`
  const first = sql`select count(*)::int as n from test`.execute()
  const tx = sql.begin(sql => sql`insert into test values (1)`)
  const [{ n }] = await first
  await tx
  return [0, n, await sql`drop table test`, await sql.end()]
})

t('A caught query that cannot be built aborts a transaction opened by hand on a reserved connection', async() => {
  const sql = postgres(options)
  await sql`create table test (a int)`
  const reserved = await sql.reserve()
  await reserved`begin`
  await reserved`insert into test values (1)`
  const bad = await reserved`select ${ undefined } as x`.catch(e => e.code)
  const commit = await reserved`commit`
  reserved.release()
  const [{ n }] = await sql`select count(*)::int as n from test`
  return ['UNDEFINED_VALUE ROLLBACK 0', bad + ' ' + commit.command + ' ' + n, await sql`drop table test`, await sql.end()]
})

t('A query that cannot be built on a reserved connection outside a transaction leaves the connection usable', async() => {
  const sql = postgres(options)
  const reserved = await sql.reserve()
  const bad = await reserved`select ${ undefined } as x`.catch(e => e.code)
  const [{ x }] = await reserved`select 1 as x`
  reserved.release()
  return ['UNDEFINED_VALUE 1', bad + ' ' + x, await sql.end()]
})

t('sql.begin inside a transaction runs in a savepoint', async() => {
  await sql`create table test (x int)`
  const result = await sql.begin(async sql => {
    await sql`insert into test values (1)`
    await sql.begin(sql => sql`insert into test values (2)`)
    await sql.begin(async sql => {
      await sql`insert into test values (3)`
      throw new Error('undo 3')
    }).catch(() => {})
    return sql`select array_agg(x order by x)::text as xs from test`
  })
  return ['{1,2}', result[0].xs, await sql`drop table test`]
})

t('A nested sql.begin with a different mode throws, the same mode is allowed', async() => {
  const codes = await sql.begin('read write', async sql => [
    await sql.begin('read only', sql => sql`select 1`).then(() => 'ran', e => e.code),
    await sql.begin('READ  write', sql => sql`select 1`).then(() => 'ran', e => e.code)
  ])
  return ['NESTED_TRANSACTION_MODE,ran', codes.join()]
})

t('A nested sql.begin can not be prepared', async() => {
  const code = await sql.begin(async sql => sql.begin(async sql => sql.prepare('x')).then(() => 'ran', e => e.code))
  return ['NESTED_TRANSACTION_MODE', code]
})

t('A tagged savepoint runs its query in a savepoint', async() => {
  const [x] = await sql.begin(sql => sql.savepoint`select 1 as x`)
  return [1, x.x]
})

t('Queries in a Promise.all inside a transaction are pipelined in the order they were made (#951)', { timeout: 10 }, async() => {
  const net = await import('net')
      , proxy = net.createServer(client => {
        const server = net.connect(5432, '127.0.0.1')
        client.on('data', x => setTimeout(() => server.write(x), 50))
        server.on('data', x => setTimeout(() => client.write(x), 50))
        client.on('close', () => server.destroy())
        server.on('close', () => client.destroy())
        client.on('error', () => {})
        server.on('error', () => {})
      })
  await new Promise(r => proxy.listen(0, '127.0.0.1', r))
  const sql = postgres({ ...options, host: '127.0.0.1', port: proxy.address().port, max: 1, fetch_types: false })
  const result = await sql.begin(async sql => {
    await sql`create table test (x int)`
    let start = Date.now()
    for (let i = 0; i < 5; i++)
      await sql`select ${ i }::int`
    const sequential = Date.now() - start
    start = Date.now()
    const [, counted, , summed] = await Promise.all([
      sql`insert into test values (1)`,
      sql`select count(*)::int as n from test`,
      sql`insert into test values (2)`,
      sql`select sum(x)::int as n from test`,
      sql`select 1`
    ])
    return [Date.now() - start < sequential / 2, counted[0].n, summed[0].n].join(' ')
  })
  await sql.end()
  proxy.close()
  return ['true 1 3', result]
})

t('sql.rollback() rolls back without throwing, and begin resolves with the result (#500)', async() => {
  await sql`create table test (x int)`
  const result = await sql.begin(async sql => {
    await sql`insert into test values (1)`
    await sql.rollback()
    return 'value'
  })
  const [{ n }] = await sql`select count(*)::int as n from test`
  return ['value 0', result + ' ' + n, await sql`drop table test`]
})

t('sql.rollback() in a savepoint or nested begin rolls back only that, and the outer transaction commits', async() => {
  await sql`create table test (x int)`
  await sql.begin(async sql => {
    await sql`insert into test values (1)`
    await sql.savepoint(async sql => (await sql`insert into test values (2)`, sql.rollback()))
    await sql.begin(async sql => (await sql`insert into test values (3)`, sql.rollback()))
    await sql`insert into test values (4)`
  })
  const [{ xs }] = await sql`select string_agg(x::text, ',' order by x) as xs from test`
  return ['1,4', xs, await sql`drop table test`]
})

t('Queries, savepoints and nested begins after sql.rollback() are not sent and reject with TRANSACTION_ROLLED_BACK', async() => {
  await sql`create table test (x int)`
  const codes = []
  const outcome = await sql.begin(async sql => {
    await sql.rollback()
    codes.push(await sql`insert into test values (1)`.catch(e => e.code))
    codes.push(await sql.savepoint(sql => sql`select 1`).catch(e => e.code))
    codes.push(await sql.begin(sql => sql`select 1`).catch(e => e.code))
  }).catch(e => e.code)
  const [{ n }] = await sql`select count(*)::int as n from test`
  return [
    'TRANSACTION_ROLLED_BACK,TRANSACTION_ROLLED_BACK,TRANSACTION_ROLLED_BACK TRANSACTION_ROLLED_BACK 0',
    codes.join() + ' ' + outcome + ' ' + n,
    await sql`drop table test`
  ]
})

t('sql.rollback() comes after the queries already made, and the connection is left idle', async() => {
  const sql = postgres({ ...options, max: 1 })
  await sql`create table test (x int)`
  let same
  await sql.begin(sql => {
    sql`insert into test values (1)`
    const a = sql.rollback()
    same = a === sql.rollback()
    return a
  })
  const [{ n }] = await sql`select count(*)::int as n from test`
      , [{ status }] = await sql`select state as status from pg_stat_activity where pid = pg_backend_pid()`
  return ['true 0 active', same + ' ' + n + ' ' + status, await sql`drop table test`, await sql.end()]
})

t('A transaction ended by transaction_timeout rejects with the FATAL error instead of CONNECTION_CLOSED (#1283)', async() => {
  const [{ supported }] = await sql`select current_setting('server_version_num')::int >= 170000 as supported`
  if (!supported)
    return [true, true]

  const timed = postgres({ ...options, max: 1 })
  const error = await timed.begin(async sql => {
    await sql`select set_config('transaction_timeout', '200', true)`
    await sql`select pg_sleep(2)`
  }).catch(e => e)
  return ['25P04 FATAL', error.code + ' ' + error.severity, await timed.end()]
})

t('A transaction whose backend is terminated mid-query rejects with the FATAL error (#1283)', async() => {
  const sql = postgres({ ...options, max: 1 })
      , killer = postgres({ ...options, max: 1 })
  const error = await sql.begin(async sql => {
    const [{ pid }] = await sql`select pg_backend_pid() as pid`
    const query = sql`select pg_sleep(2)`.execute()
    while (!(await killer`select wait_event = 'PgSleep' as sleeping from pg_stat_activity where pid = ${ pid }`)[0].sleeping)
      await delay(1)
    await killer`select pg_terminate_backend(${ pid })`
    await query
  }).catch(e => e)
  return ['57P01 FATAL', error.code + ' ' + error.severity, await killer.end(), await sql.end()]
})

t('A transaction terminated between statements rejects with the FATAL error, and its next query has it as cause (#1283)', async() => {
  const sql = postgres({ ...options, max: 1 })
      , killer = postgres({ ...options, max: 1 })
  let settled
  const next = new Promise(r => settled = r)
  const error = await sql.begin(async sql => {
    const [{ pid }] = await sql`select pg_backend_pid() as pid`
    await killer`select pg_terminate_backend(${ pid })`
    await delay(100)
    settled(await sql`select 1`.catch(e => e))
  }).catch(e => e)
  const later = await next
  return [
    '57P01 FATAL CONNECTION_CLOSED 57P01',
    [error.code, error.severity, later.code, later.cause && later.cause.code].join(' '),
    await killer.end(),
    await sql.end()
  ]
})

t('A savepoint or nested begin rejects when the connection is lost while its callback runs (#1281)', { timeout: 10 }, async() => {
  const outcomes = []
  for (const method of ['savepoint', 'begin']) {
    const sql = postgres({ ...options, max: 1 })
        , killer = postgres({ ...options, max: 1 })
    let started
      , release
      , settled
    const pid = new Promise(r => started = r)
        , gate = new Promise(r => release = r)
        , child = new Promise(r => settled = r)
    const root = sql.begin(sql =>
      sql[method](async sql => {
        const [x] = await sql`select pg_backend_pid() as pid`
        started(x.pid)
        await gate
        return 'child'
      }).then(() => 'fulfilled', e => e.code).then(x => (settled(x), x))
    ).catch(e => e.code)
    await killer`select pg_terminate_backend(${ await pid })`
    const outer = await root
    release()
    outcomes.push(outer + ' ' + await child)
    await killer.end()
    await sql.end()
  }
  return ['CONNECTION_CLOSED CONNECTION_CLOSED,CONNECTION_CLOSED CONNECTION_CLOSED', outcomes.join()]
})
