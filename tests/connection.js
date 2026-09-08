import assert from 'assert'
import { createServer } from 'net'
import postgres from '../src/index.js'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
    , ready = message('Z', [73])

export function cleanClose() {
  let attempts = 0
    , closes = 0
  const retries = []

  return peer(() => (++attempts, 'close'), {
    connect_timeout: 0.15,
    backoff: retry => (retries.push(retry), 0.025),
    onclose: () => closes++
  }, async sql => {
    const error = await sql`select 1`.catch(error => error)
    assert.strictEqual(error.code, 'CONNECTION_CLOSED')
    assert(attempts > 1 && attempts < 15)
    assert.strictEqual(closes, 1)
    assert.deepStrictEqual(retries, retries.map((_, i) => i + 1))
    const settled = attempts
    await delay(75)
    assert.strictEqual(attempts, settled)
  })
}

export function queuedClose() {
  return peer(() => 'close', {
    connect_timeout: 0.1,
    backoff: 0.025
  }, async sql => {
    const errors = await Promise.all([
      sql`select 1`.catch(error => error.code),
      sql`select 2`.catch(error => error.code),
      sql.reserve().catch(error => error.code)
    ])
    assert.deepStrictEqual(errors, ['CONNECTION_CLOSED', 'CONNECTION_CLOSED', 'CONNECTION_CLOSED'])
  })
}

export function closeBackoff() {
  let attempts = 0
  return peer(() => (++attempts, 'close'), {
    connect_timeout: 0.1,
    backoff: 2
  }, async sql => {
    const start = Date.now()
    assert.strictEqual(await sql`select 1`.catch(error => error.code), 'CONNECTION_CLOSED')
    assert(Date.now() - start < 500)
    assert.strictEqual(attempts, 1)
  })
}

export function closeRecovery() {
  let attempts = 0
  return peer(() => ++attempts <= 6 ? 'close' : 'ready', {
    connect_timeout: 0.5,
    backoff: 0.025
  }, async sql => {
    assert.strictEqual((await sql`select 1`).command, 'SELECT')
    assert.strictEqual(attempts, 7)
  })
}

export function closeReset() {
  let attempts = 0
  return peer(() => ++attempts % 3 ? 'close' : 'ready', {
    connect_timeout: 0.15,
    backoff: 0.025
  }, async sql => {
    for (let i = 0; i < 3; i++) {
      assert.strictEqual((await sql`select 1`).command, 'SELECT')
      await sql.close()
      await delay(175)
    }
    assert.strictEqual(attempts, 9)
  })
}

export function reserveCloseReset() {
  let attempts = 0
  const retries = []
  return peer(() => ++attempts % 3 ? 'close' : 'ready', {
    connect_timeout: 0.15,
    backoff: retry => (retries.push(retry), 0.025)
  }, async sql => {
    for (let i = 0; i < 3; i++) {
      const reserved = await sql.reserve()
      assert.strictEqual((await reserved`select 1`).command, 'SELECT')
      reserved.release()
      await sql.close()
      await delay(175)
    }
    assert.strictEqual(attempts, 9)
    assert.deepStrictEqual(retries.filter(retry => retry > 0), [1, 2, 1, 2, 1, 2])
  })
}

export function closeErrorReset() {
  let attempts = 0
  return peer(() => ++attempts === 2 ? 'error' : attempts < 5 ? 'close' : 'ready', {
    connect_timeout: 0.15,
    backoff: 0.025
  }, async sql => {
    assert.strictEqual(await sql`select 1`.catch(error => error.code), '53300')
    await delay(175)
    assert.strictEqual((await sql`select 1`).command, 'SELECT')
    assert.strictEqual(attempts, 5)
  })
}

async function peer(accept, options, run) {
  const sockets = new Set()
      , server = createServer(socket => {
        sockets.add(socket)
        socket.on('close', () => sockets.delete(socket))
        const action = accept()
        let incoming = Buffer.alloc(0)
          , startup = true
        socket.on('data', data => {
          const responses = []
          incoming = Buffer.concat([incoming, data])
          while (incoming.length >= (startup ? 4 : 5)) {
            const length = startup ? incoming.readUInt32BE(0) : incoming.readUInt32BE(1) + 1
            if (incoming.length < length)
              break
            const type = incoming[0]
            incoming = incoming.subarray(length)
            if (startup) {
              startup = false
              if (action === 'close')
                return socket.end()
              if (action === 'error')
                return socket.end(message('E', Buffer.from('SFATAL\0C53300\0Mtoo many connections\0\0')))
              responses.push(message('R', [0, 0, 0, 0]), ready)
            } else if (type === 80) { // Parse
              responses.push(message('1'))
            } else if (type === 68) { // Describe
              responses.push(message('t', [0, 0]), message('n'))
            } else if (type === 66) { // Bind
              responses.push(message('2'))
            } else if (type === 69 || type === 81) { // Execute or Query
              responses.push(message('C', Buffer.from('SELECT 0\0')))
              type === 81 && responses.push(ready)
            } else if (type === 83) { // Sync
              responses.push(ready)
            } else if (type === 88) { // Terminate
              socket.end()
            }
          }
          responses.length && socket.write(Buffer.concat(responses))
        })
      })

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const sql = postgres({
    host: '127.0.0.1',
    port: server.address().port,
    user: 'test',
    database: 'test',
    ssl: false,
    max: 1,
    prepare: false,
    ...options
  })
  const timeout = setTimeout(() => sql.end({ timeout: 0 }), 2000)
  try {
    await run(sql)
    return [true, true]
  } finally {
    clearTimeout(timeout)
    await sql.end({ timeout: 0 })
    sockets.forEach(socket => socket.destroy())
    await new Promise(resolve => server.close(resolve))
  }
}

function message(type, data = []) {
  const payload = Buffer.from(data)
      , header = Buffer.alloc(5)
  header[0] = type.charCodeAt(0)
  header.writeUInt32BE(payload.length + 4, 1)
  return Buffer.concat([header, payload])
}
