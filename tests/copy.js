import fs from 'fs'
import crypto from 'crypto'
import { pipeline } from 'stream/promises'
import stream from 'stream'
import { t } from './test.js'
import { postgres, sql, options, delay, rel } from './setup.js'

t('Copy read', async() => {
  const result = []

  await sql`create table test (x int)`
  await sql`insert into test select * from generate_series(1,10)`
  const readable = await sql`copy test to stdout`.readable()
  readable.on('data', x => result.push(x))
  await new Promise(r => readable.on('end', r))

  return [
    result.length,
    10,
    await sql`drop table test`
  ]
})

t('Copy write', async() => {
  await sql`create table test (x int)`
  const writable = await sql`copy test from stdin`.writable()

  writable.write('1\n')
  writable.write('1\n')
  writable.end()

  await new Promise(r => writable.on('finish', r))

  return [
    (await sql`select 1 from test`).length,
    2,
    await sql`drop table test`
  ]
})

t('Copy write as first', async() => {
  await sql`create table test (x int)`
  const first = postgres(options)
  const writable = await first`COPY test FROM STDIN WITH(FORMAT csv, HEADER false, DELIMITER ',')`.writable()
  writable.write('1\n')
  writable.write('1\n')
  writable.end()

  await new Promise(r => writable.on('finish', r))

  return [
    (await sql`select 1 from test`).length,
    2,
    await sql`drop table test`
  ]
})

t('Copy from file', async() => {
  await sql`create table test (x int, y int, z int)`
  await new Promise(async r => fs
    .createReadStream(rel('copy.csv'))
    .pipe(await sql`copy test from stdin`.writable())
    .on('finish', r)
  )

  return [
    JSON.stringify(await sql`select * from test`),
    '[{"x":1,"y":2,"z":3},{"x":4,"y":5,"z":6}]',
    await sql`drop table test`
  ]
})

t('Copy from works in transaction', async() => {
  await sql`create table test(x int)`
  const xs = await sql.begin(async sql => {
    (await sql`copy test from stdin`.writable()).end('1\n2')
    await delay(20)
    return sql`select 1 from test`
  })

  return [
    xs.length,
    2,
    await sql`drop table test`
  ]
})

t('Copy from abort', async() => {
  const sql = postgres(options)
  const readable = fs.createReadStream(rel('copy.csv'))

  await sql`create table test (x int, y int, z int)`
  await sql`TRUNCATE TABLE test`

  const writable = await sql`COPY test FROM STDIN`.writable()

  let aborted

  readable
    .pipe(writable)
    .on('error', (err) => aborted = err)

  writable.destroy(new Error('abort'))
  await sql.end()

  return [
    'abort',
    aborted.message,
    await postgres(options)`drop table test`
  ]
})

t('query during copy error', async() => {
  const sql = postgres(options)
  await sql`create table test (id serial primary key, name text)`
  const copy = await sql`copy test from stdin`.writable()
  const error = await sql`select 1`.catch(e => e)
  await copy.end()

  return [
    'COPY_IN_PROGRESS', error.code,
    await sql`drop table test`
  ]
})

t('Copy from settles instead of hanging when the server rejects the data', async() => {
  await sql`create table test (x int, y int)`

  const error = await sql.begin(async sql => {
    const writable = await sql`copy test from stdin`.writable()
    await new Promise((resolve, reject) => {
      writable.on('error', reject)
      writable.on('finish', resolve)
      writable.end('1\t2\t3\n')
    })
  }).catch(e => e)

  const [{ count }] = await sql`
    select count(*)::int as count from pg_stat_activity
    where state = 'idle in transaction (aborted)'
  `

  return ['22P04,0', error.code + ',' + count, await sql`drop table test`]
})

t('Copy read with back-pressure', async() => {
  await sql`create table test (x int)`

  const bufferSize = Math.ceil(stream.getDefaultHighWaterMark(false) / 6)
  await sql`insert into test select * from generate_series(10000, ${ 9999 + bufferSize })`

  let result = 0
  const readable = await sql`copy test to stdout`.readable()
  readable.on('data', () => result++)
  readable.pause()

  await Promise.all([
    new Promise(r => readable.on('end', r)),
    new Promise(r => readable.on('readable', () => {
      if (readable.readableBuffer.length === bufferSize) {
        readable.removeAllListeners('readable')
        r()
      }
    }))
  ])

  await sql`select 1`

  return [bufferSize, result, await sql`drop table test`]
})

t('Copy read through a slow pipeline keeps every byte and never stalls', { timeout: 30 }, () => slowCopy(sql))

t('Copy read through a slow pipeline over direct TLS keeps every byte', { timeout: 30 }, async() => {
  const [{ supported }] = await sql`select current_setting('server_version_num')::int >= 170000 as supported`
  if (!supported)
    return [true, true]

  const tls = postgres({ ...options, ssl: 'require', sslnegotiation: 'direct', max: 1 })
  const [{ ssl }] = await tls`select ssl from pg_stat_ssl where pid = pg_backend_pid()`
  const [expected, got] = await slowCopy(tls)
  await tls.end()
  return [expected + ' true', got + ' ' + ssl]
})

async function slowCopy(sql) {
  const query = 'select i, md5(i::text) || repeat(chr(65 + i % 26), i % 300) from generate_series(1, 50000) i'
      , [{ expected }] = await sql.unsafe(`select md5(string_agg(i || E'\\t' || x || E'\\n', '' order by i)) as expected from (${ query }) t(i, x)`)
      , hash = crypto.createHash('md5')
  let n = 0
  await pipeline(
    await sql.unsafe(`copy (${ query }) to stdout`).readable(),
    new stream.Writable({
      highWaterMark: 1024,
      write(chunk, encoding, callback) {
        hash.update(chunk)
        n++ % 500 === 0 ? setTimeout(callback, 1) : n % 3 ? callback() : setImmediate(callback)
      }
    })
  )
  return [expected, hash.digest('hex')]
}

t('A query on a reserved connection during its COPY is rejected and the COPY completes', async() => {
  await sql`create table test (a int)`
  const reserved = await sql.reserve()
  const writable = await reserved`copy test from stdin`.writable()
  writable.write('1\n')
  const code = await reserved`select 1`.then(() => 'ran', e => e.code)
  await new Promise((resolve, reject) => (writable.on('finish', resolve), writable.on('error', reject), writable.end('2\n')))
  const [{ n }] = await reserved`select count(*)::int as n from test`
  reserved.release()
  return ['COPY_IN_PROGRESS 2', code + ' ' + n, await sql`drop table test`]
})

t('A copy from stdin writable has the count of rows copied once it finishes (#465)', async() => {
  await sql`create table test (x int)`
  const writable = await sql`copy test from stdin`.writable()
  await new Promise((resolve, reject) => {
    writable.on('finish', resolve)
    writable.on('error', reject)
    writable.write('1\n2\n')
    writable.end('3\n')
  })
  return ['3 COPY', writable.count + ' ' + writable.command, await sql`drop table test`]
})

t('Copy write waits for the socket to drain between large chunks', { timeout: 10 }, async() => {
  await sql`create table test (x text)`
  const line = 'x'.repeat(1024 * 1024 - 1) + '\n'
      , writable = await sql`copy test from stdin`.writable()
  await pipeline(stream.Readable.from(Array.from({ length: 8 }, () => line)), writable)
  const [{ n }] = await sql`select count(*)::int as n from test`
  return ['8 8', writable.count + ' ' + n, await sql`drop table test`]
})
