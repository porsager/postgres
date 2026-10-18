import { t } from './test.js'
import { postgres, sql, options, delay } from './setup.js'

t('forEach', async() => {
  let result
  await sql`select 1 as x`.forEach(({ x }) => result = x)
  return [1, result]
})

t('forEach returns empty array', async() => {
  return [0, (await sql`select 1 as x`.forEach(() => {})).length]
})

t('Cursor', async() => {
  const order = []
  await sql`select 1 as x union select 2 as x`.cursor(async([x]) => {
    order.push(x.x + 'a')
    await delay(100)
    order.push(x.x + 'b')
  })
  return ['1a1b2a2b', order.join('')]
})

t('Unsafe cursor', async() => {
  const order = []
  await sql.unsafe('select 1 as x union select 2 as x').cursor(async([x]) => {
    order.push(x.x + 'a')
    await delay(100)
    order.push(x.x + 'b')
  })
  return ['1a1b2a2b', order.join('')]
})

t('Cursor custom n', async() => {
  const order = []
  await sql`select * from generate_series(1,20)`.cursor(10, async(x) => {
    order.push(x.length)
  })
  return ['10,10', order.join(',')]
})

t('Cursor custom with rest n', async() => {
  const order = []
  await sql`select * from generate_series(1,20)`.cursor(11, async(x) => {
    order.push(x.length)
  })
  return ['11,9', order.join(',')]
})

t('Cursor custom with less results than batch size', async() => {
  const order = []
  await sql`select * from generate_series(1,20)`.cursor(21, async(x) => {
    order.push(x.length)
  })
  return ['20', order.join(',')]
})

t('Cursor cancel', async() => {
  let result
  await sql`select * from generate_series(1,10) as x`.cursor(async([{ x }]) => {
    result = x
    return sql.CLOSE
  })
  return [1, result]
})

t('Cursor throw', async() => {
  const order = []
  await sql`select 1 as x union select 2 as x`.cursor(async([x]) => {
    order.push(x.x + 'a')
    await delay(100)
    throw new Error('watty')
  }).catch(() => order.push('err'))
  return ['1aerr', order.join('')]
})

t('Cursor error', async() => [
  '42601',
  await sql`wat`.cursor(() => {}).catch((err) => err.code)
])

t('Multiple Cursors', async() => {
  const result = []
  await sql.begin(async sql => [
    await sql`select 1 as cursor, x from generate_series(1,4) as x`.cursor(async([row]) => {
      result.push(row.x)
      await new Promise(r => setTimeout(r, 20))
    }),
    await sql`select 2 as cursor, x from generate_series(101,104) as x`.cursor(async([row]) => {
      result.push(row.x)
      await new Promise(r => setTimeout(r, 10))
    })
  ])

  return ['1,2,3,4,101,102,103,104', result.join(',')]
})

t('Cursor as async iterator', async() => {
  const order = []
  for await (const [x] of sql`select generate_series(1,2) as x;`.cursor()) {
    order.push(x.x + 'a')
    await delay(10)
    order.push(x.x + 'b')
  }

  return ['1a1b2a2b', order.join('')]
})

t('Cursor as async iterator with break', async() => {
  const order = []
  for await (const xs of sql`select generate_series(1,2) as x;`.cursor()) {
    order.push(xs[0].x + 'a')
    await delay(10)
    order.push(xs[0].x + 'b')
    break
  }

  return ['1a1b', order.join('')]
})

t('Async Iterator Unsafe cursor', async() => {
  const order = []
  for await (const [x] of sql.unsafe('select 1 as x union select 2 as x').cursor()) {
    order.push(x.x + 'a')
    await delay(10)
    order.push(x.x + 'b')
  }
  return ['1a1b2a2b', order.join('')]
})

t('Async Iterator Cursor custom n', async() => {
  const order = []
  for await (const x of sql`select * from generate_series(1,20)`.cursor(10))
    order.push(x.length)

  return ['10,10', order.join(',')]
})

t('Async Iterator Cursor custom with rest n', async() => {
  const order = []
  for await (const x of sql`select * from generate_series(1,20)`.cursor(11))
    order.push(x.length)

  return ['11,9', order.join(',')]
})

t('Async Iterator Cursor custom with less results than batch size', async() => {
  const order = []
  for await (const x of sql`select * from generate_series(1,20)`.cursor(21))
    order.push(x.length)
  return ['20', order.join(',')]
})

t('forEach has result as second argument', async() => {
  let x
  await sql`select 1 as x`.forEach((_, result) => x = result)
  return ['x', x.columns[0].name]
})

t('concurrent cursors', async() => {
  const xs = []

  await Promise.all([...Array(7)].map((x, i) => [
    sql`select ${ i }::int as a, generate_series(1, 2) as x`.cursor(([x]) => xs.push(x.a + x.x))
  ]).flat())

  return ['12233445566778', xs.join('')]
})

t('concurrent cursors multiple connections', async() => {
  const sql = postgres({ ...options, max: 2 })
  const xs = []

  await Promise.all([...Array(7)].map((x, i) => [
    sql`select ${ i }::int as a, generate_series(1, 2) as x`.cursor(([x]) => xs.push(x.a + x.x))
  ]).flat())

  return ['12233445566778', xs.sort().join('')]
})

t('Async iterator cursor surfaces an error arriving between batches', async() => {
  const iterator = sql`select 1 / (3 - x) as x from generate_series(1, 5) as x`.cursor(1)[Symbol.asyncIterator]()
  await iterator.next()
  const code = await iterator.next().then(() => iterator.next()).then(() => 'no error', e => e.code)
  await iterator.return()
  return ['22012', code]
})

t('A cursor in a transaction that resumes while another query waits on its description gives each its own answer', { timeout: 10 }, async() => {
  const sql = postgres(options)
  const out = []
  await sql.begin(async sql => {
    let release
    const batches = []
    const cursor = sql`select generate_series(1, 6) as x`.cursor(2, rows => {
      batches.push(rows.map(r => r.x))
      return new Promise(r => release = r)
    })
    const done = cursor.then(() => JSON.stringify(batches))
        , until = async fn => { while (!fn()) await delay(5) }
        , next = async() => {
          const before = release
          before()
          await until(() => release !== before || batches.length === 3)
        }
    await until(() => release)
    const q = sql`select ${ 'value' }::text as a, ${ Math.random() }::float8 as cursor_order_shape`
    q.catch(() => {})
    for (let i = 0; i < 10; i++)
      await Promise.resolve()
    await next()
    await next()
    release()
    out.push((await q)[0].a, await done)
  })
  return ['value [[1,2],[3,4],[5,6]]', out.join(' '), await sql.end()]
})

t('A cursor on a reserved connection keeps its rows from a query made while it runs', { timeout: 10 }, async() => {
  const sql = postgres(options)
  const reserved = await sql.reserve()
  const batches = []
  const cursor = reserved`select generate_series(1, 6) as x`.cursor(2, async rows => {
    batches.push(rows.map(r => r.x))
    await delay(50)
  })
  cursor.catch(() => {})
  while (!batches.length)
    await delay(2)
  const [{ a }] = await reserved`select 'q1' as a`
  await cursor
  reserved.release()
  return ['q1 [[1,2],[3,4],[5,6]]', a + ' ' + JSON.stringify(batches), await sql.end()]
})

t('A cursor that outlives its transaction is rejected instead of running in the next one', { timeout: 10 }, async() => {
  const sql = postgres({ ...options, max: 1 })
  await sql`create table test (a int)`
  let cursor
  const first = await sql.begin(sql => {
    cursor = sql`select generate_series(1, 6) as x`.cursor(2, () => delay(100))
    return Promise.all([cursor, sql`select 1/0`])
  }).catch(e => e.code)
  const second = await sql.begin(async sql => {
    await sql`insert into test values (1)`
    await delay(300)
    await sql`insert into test values (2)`
    return 'committed'
  }).catch(e => e.code)
  const outlived = await cursor.catch(e => e.code)
  const [{ n }] = await sql`select count(*)::int as n from test`
  return ['22012 committed 2 true', [first, second, n, outlived !== undefined].join(' '), await sql`drop table test`, await sql.end()]
})

t('A pool cursor whose parameter serializer returns a number rejects and frees the connection', async() => {
  const sql = postgres({ ...options, max: 1, types: { ms: { to: 20, from: [], serialize: x => x.getTime() } } })
  const run = () => sql`select ${ sql.types.ms(new Date(0)) }::int8 as x`.cursor(10, () => {}).then(() => 'ok', e => e.name)
  return [
    'TypeError,TypeError,1',
    [await run(), await run(), (await sql`select 1 as x`)[0].x].join(),
    await sql.end()
  ]
})

t('A transaction waits for a cursor it did not await before it commits', async() => {
  const batches = []
  let cursor
  await sql.begin(async sql => {
    cursor = sql`select generate_series(1, 4) as x`.cursor(1, async([row]) => {
      batches.push(row.x)
      await delay(20)
    })
    cursor.catch(() => {})
    await delay(10)
  })
  return ['ok 1,2,3,4', (await cursor.then(() => 'ok', e => e.code)) + ' ' + batches.join()]
})

t('A transaction that returns right after starting a cursor still lets the cursor finish', async() => {
  const batches = []
  let cursor
  await sql.begin(sql => {
    cursor = sql`select generate_series(1, 3) as x`.cursor(1, ([row]) => { batches.push(row.x) })
    cursor.catch(() => {})
  })
  return ['ok 1,2,3', (await cursor.then(() => 'ok', e => e.code)) + ' ' + batches.join()]
})

t('A pool cursor whose callback throws on the last batch rejects and frees the connection', async() => {
  const sql = postgres({ ...options, max: 1 })
  const error = await sql`select generate_series(1, 3) as x`.cursor(2, rows => {
    if (rows[0].x === 3)
      throw new Error('last')
  }).then(() => 'resolved', e => e.message)
  return ['last 1', error + ' ' + (await sql`select 1 as x`)[0].x, await sql.end()]
})

t('A pool cursor whose column parser throws rejects and frees the connection', async() => {
  const sql = postgres({
    ...options,
    max: 1,
    types: { bad: { to: 0, from: [23], parse: x => { if (x === '3') throw new Error('parser'); return +x } } }
  })
  const error = await sql`select generate_series(1, 6)::int as x`.cursor(2, () => {}).then(() => 'resolved', e => e.message)
  return ['parser 1', error + ' ' + (await sql`select 1 as x`)[0].x, await sql.end()]
})

t('A reserved cursor whose callback throws on the last batch rejects and leaves the connection usable', async() => {
  const sql = postgres({ ...options, max: 1 })
  const reserved = await sql.reserve()
  const error = await reserved`select generate_series(1, 3) as x`.cursor(2, rows => {
    if (rows[0].x === 3)
      throw new Error('last')
  }).then(() => 'resolved', e => e.message)
  const [{ x }] = await reserved`select 1 as x`
  reserved.release()
  return ['last 1', error + ' ' + x, await sql.end()]
})

async function outlives(fn) {
  const sql = postgres({ ...options, max: 1 })
  let cursor
  await sql.begin(sql => {
    cursor = sql`select generate_series(1, 6) as x`.cursor(2, () => delay(100).then(() => fn(sql)))
    return Promise.all([cursor, sql`select 1/0`])
  }).catch(() => {})
  const second = await sql.begin(async() => (await delay(300), 'committed'))
  const outcome = await cursor.then(x => 'resolved ' + x.length, e => e.code || e.message)
  return [second, outcome, await sql.end()]
}

t('A cursor that throws in its failed transaction rejects with its own error, and the next transaction commits', { timeout: 10 }, async() => {
  const [second, outcome] = await outlives(() => { throw new Error('late') })
  return ['committed late', second + ' ' + outcome]
})

t('A cursor that closes in its failed transaction rejects with 25P02, and the next transaction commits', { timeout: 10 }, async() => {
  const [second, outcome] = await outlives(sql => sql.CLOSE)
  return ['committed 25P02', second + ' ' + outcome]
})

async function aborted(sql, how) {
  const controller = new AbortController()
      , query = sql`select generate_series(1, 10) as x`
  let calls = 0
  how === 'signal' && query.signal(controller.signal)
  const outcome = await query.cursor(2, async() => {
    calls++
    how === 'signal' ? controller.abort() : query.cancel()
    await delay(20)
  }).then(() => 'resolved', e => e.code)
  return outcome + ' ' + calls
}

t('Aborting a pool cursor while its callback runs stops it with 57014', async() => {
  const sql = postgres({ ...options, max: 1 })
  const outcomes = [await aborted(sql, 'signal'), await aborted(sql, 'cancel'), (await sql`select 1 as x`)[0].x]
  return ['57014 1 57014 1 1', outcomes.join(' '), await sql.end()]
})

t('Cancelling a reserved cursor while its callback runs stops it with 57014', async() => {
  const sql = postgres({ ...options, max: 1 })
      , reserved = await sql.reserve()
  const outcome = await aborted(reserved, 'cancel')
      , [{ x }] = await reserved`select 1 as x`
  reserved.release()
  return ['57014 1 1', outcome + ' ' + x, await sql.end()]
})

t('Aborting a cursor in a transaction stops it with 57014, which rejects the transaction', async() => {
  const sql = postgres({ ...options, max: 1 })
  let inside
  const outcome = await sql.begin(async sql => inside = await aborted(sql, 'signal')).catch(e => e.code)
  return ['57014 1 57014', inside + ' ' + outcome, await sql.end()]
})

t('Aborting a cursor used as an async iterator stops it with 57014', async() => {
  const controller = new AbortController()
  let batches = 0
    , outcome = 'done'
  try {
    for await (const rows of sql`select generate_series(1, 10) as x`.signal(controller.signal).cursor(2)) {
      batches += rows.length / 2
      controller.abort()
    }
  } catch (e) {
    outcome = e.code
  }
  return ['57014 1', outcome + ' ' + batches]
})

t('A cursor waits for the callback of its last batch, and rejects if it does', async() => {
  const sql = postgres({ ...options, max: 1 })
      , last = async(sql, fail) => {
        const seen = []
        const outcome = await sql`select generate_series(1, 3) as x`.cursor(2, async rows => {
          await delay(20)
          seen.push(rows[0].x)
          if (fail && rows[0].x === 3)
            throw new Error('last')
        }).then(() => 'resolved', e => e.message)
        return seen.join() + ' ' + outcome
      }
  const outcomes = [await last(sql), await last(sql, true)]
      , reserved = await sql.reserve()
  outcomes.push(await last(reserved), await last(reserved, true))
  reserved.release()
  return ['1,3 resolved|1,3 last|1,3 resolved|1,3 last', outcomes.join('|'), await sql.end()]
})

t('A reserved cursor whose callback throws at once rejects and leaves the connection open', async() => {
  const sql = postgres({ ...options, max: 1 })
      , reserved = await sql.reserve()
  const error = await reserved`select generate_series(1, 10) as x`.cursor(2, () => { throw new Error('at once') }).catch(e => e.message)
  const [{ x }] = await reserved`select 1 as x`
  reserved.release()
  return ['at once 1', error + ' ' + x, await sql.end()]
})
