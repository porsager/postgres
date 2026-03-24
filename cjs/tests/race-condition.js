/**
 * Race Condition Tests for UNSAFE_TRANSACTION in postgres.js
 *
 * Tests the fix for a bug where sql.begin() throws UNSAFE_TRANSACTION
 * under concurrent load. The root cause: execute()'s short-circuit
 * evaluation skips the onexecute callback (which sets connection.reserved)
 * when sent.length >= max_pipeline during query pipelining.
 *
 * All tests run against a real PostgreSQL database.
 *
 * Usage:
 *   export PATH="/usr/local/opt/postgresql@15/bin:$PATH"
 *   node tests/race-condition.js
 *
 * Setup:
 *   createuser postgres_js_test
 *   createdb -O postgres_js_test postgres_js_test
 */

const postgres = require('../src/index.js')

const delay = ms => new Promise(r => setTimeout(r, ms))

const pgOptions = {
  db: 'postgres_js_test',
  user: 'postgres_js_test',
  idle_timeout: null,
  connect_timeout: 10,
}

// ─── Test Runner ────────────────────────────────────────────────────────────

let testCount = 0, passCount = 0, failCount = 0

async function test(name, fn) {
  testCount++
  try {
    await fn()
    passCount++
    console.log(`  \x1b[32mPASS\x1b[0m ${name}`)
  } catch (e) {
    failCount++
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}`)
    console.log(`       ${e.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed')
}

// ─── Test 1: Pipeline overflow must not skip onexecute ──────────────────────
//
// With max_pipeline: 1, any BEGIN pipelined onto a busy connection would
// have sent.length >= 1 in the old code, causing the short-circuit to skip
// onexecute → connection.reserved never set → UNSAFE_TRANSACTION.
//
// After the fix, onexecute fires regardless of pipeline depth.

async function testPipelineOverflow() {
  await test('BEGIN under pipeline pressure does not cause UNSAFE_TRANSACTION', async () => {
    const errors = []

    const sql = postgres({
      ...pgOptions,
      max: 2,
      max_pipeline: 1,
    })

    try {
      await sql`SELECT 1`

      const promises = []
      for (let i = 0; i < 30; i++) {
        promises.push(
          sql`SELECT ${i}::int`.catch(e => { errors.push(e); return e })
        )
        if (i % 3 === 0) {
          promises.push(
            sql.begin(async tx => {
              await tx`SELECT ${i}::int as n`
              return 'ok'
            }).catch(e => { errors.push(e); return e })
          )
        }
      }

      await Promise.allSettled(
        promises.map(p =>
          Promise.race([p, delay(15000).then(() => { throw new Error('timeout') })])
        )
      )

      await sql.end({ timeout: 2 }).catch(() => {})

      const unsafeErrors = errors.filter(e => e.code === 'UNSAFE_TRANSACTION')
      assert(
        unsafeErrors.length === 0,
        `Got ${unsafeErrors.length} UNSAFE_TRANSACTION error(s) — onexecute was skipped during pipelining`
      )
    } finally {
      await sql.end({ timeout: 1 }).catch(() => {})
    }
  })
}

// ─── Test 2: Concurrent begins each get exclusive connections ────────────────
//
// Multiple concurrent sql.begin() calls must each get exclusive access to
// a connection. No two active transactions should share the same backend PID.

async function testConnectionExclusivity() {
  await test('Concurrent begins each get exclusive connection (no PID sharing)', async () => {
    const sql = postgres({
      ...pgOptions,
      max: 3,
      max_pipeline: 2,
    })

    const activePids = new Map()
    const conflicts = []
    const errors = []

    try {
      await sql`SELECT 1`

      const promises = Array.from({ length: 20 }, (_, i) =>
        sql.begin(async tx => {
          const [{ pid }] = await tx`SELECT pg_backend_pid() as pid`

          if (!activePids.has(pid)) activePids.set(pid, new Set())
          const active = activePids.get(pid)

          if (active.size > 0)
            conflicts.push({ tx: i, pid, sharedWith: [...active] })

          active.add(i)
          await tx`SELECT pg_sleep(0.02)`
          active.delete(i)
          return 'ok'
        }).catch(e => { errors.push(e); return e })
      )

      await Promise.allSettled(
        promises.map(p =>
          Promise.race([p, delay(30000).then(() => { throw new Error('timeout') })])
        )
      )

      await sql.end({ timeout: 2 }).catch(() => {})

      const unsafeErrors = errors.filter(e => e.code === 'UNSAFE_TRANSACTION')
      assert(
        unsafeErrors.length === 0,
        `Got ${unsafeErrors.length} UNSAFE_TRANSACTION error(s)`
      )
      assert(
        conflicts.length === 0,
        `${conflicts.length} transaction(s) shared a connection: ` +
        conflicts.slice(0, 3).map(c => `tx${c.tx} on pid ${c.pid}`).join(', ')
      )
    } finally {
      await sql.end({ timeout: 1 }).catch(() => {})
    }
  })
}

// ─── Test 3: Stress — many concurrent begins + queries ──────────────────────
//
// 50 concurrent sql.begin() calls interleaved with regular queries on a
// small connection pool. Tests that the fix holds under realistic pressure.

async function testStress() {
  await test('Stress: 50 concurrent begins + 100 queries on 5 connections', async () => {
    const errors = []

    const sql = postgres({
      ...pgOptions,
      max: 5,
    })

    try {
      await sql`SELECT 1`

      const promises = []

      for (let i = 0; i < 100; i++) {
        promises.push(
          sql`SELECT ${i}::int`.catch(e => { errors.push(e); return e })
        )
        if (i % 2 === 0) {
          promises.push(
            sql.begin(async tx => {
              await tx`SELECT ${i}::int as n`
              await tx`SELECT ${i + 1}::int as m`
              return 'ok'
            }).catch(e => { errors.push(e); return e })
          )
        }
      }

      const results = await Promise.allSettled(
        promises.map(p =>
          Promise.race([p, delay(30000).then(() => { throw new Error('timeout') })])
        )
      )

      await sql.end({ timeout: 2 }).catch(() => {})

      const unsafeErrors = errors.filter(e => e.code === 'UNSAFE_TRANSACTION')
      const fulfilled = results.filter(r => r.status === 'fulfilled')
      const timedOut = results.filter(
        r => r.status === 'rejected' && r.reason?.message === 'timeout'
      )

      assert(
        unsafeErrors.length === 0,
        `Got ${unsafeErrors.length} UNSAFE_TRANSACTION error(s) under stress`
      )
      assert(
        timedOut.length === 0,
        `${timedOut.length} operation(s) timed out — possible connection state corruption`
      )
      assert(
        errors.length === 0,
        `Got ${errors.length} error(s): ${errors.slice(0, 3).map(e => (e.code || '') + ': ' + e.message).join('; ')}`
      )
    } finally {
      await sql.end({ timeout: 1 }).catch(() => {})
    }
  })
}

// ─── Test 4: Low pipeline + high concurrency ────────────────────────────────
//
// max_pipeline: 2 with heavy concurrent load. Before the fix, this
// reliably produced UNSAFE_TRANSACTION every round.

async function testLowPipelineStress() {
  await test('Low pipeline (max_pipeline=2): 50 queries + 17 begins on 3 connections', async () => {
    const errors = []

    const sql = postgres({
      ...pgOptions,
      max: 3,
      max_pipeline: 2,
    })

    try {
      await sql`SELECT 1`

      const promises = []
      for (let i = 0; i < 50; i++) {
        promises.push(
          sql`SELECT ${i}::int`.catch(e => { errors.push(e); return e })
        )
        if (i % 3 === 0) {
          promises.push(
            sql.begin(async tx => {
              await tx`SELECT ${i}::int as n`
              return 'ok'
            }).catch(e => { errors.push(e); return e })
          )
        }
      }

      await Promise.allSettled(
        promises.map(p =>
          Promise.race([p, delay(15000).then(() => { throw new Error('timeout') })])
        )
      )

      await sql.end({ timeout: 2 }).catch(() => {})

      const unsafeErrors = errors.filter(e => e.code === 'UNSAFE_TRANSACTION')
      assert(
        unsafeErrors.length === 0,
        `Got ${unsafeErrors.length} UNSAFE_TRANSACTION error(s) — pipeline overflow caused onexecute skip`
      )
      assert(
        errors.length === 0,
        `Got ${errors.length} error(s): ${errors.slice(0, 3).map(e => (e.code || '') + ': ' + e.message).join('; ')}`
      )
    } finally {
      await sql.end({ timeout: 1 }).catch(() => {})
    }
  })
}

// ─── Test 5: Transaction data integrity ─────────────────────────────────────
//
// Each transaction writes and reads a value. Verify that no transaction
// sees another transaction's data (would indicate connection sharing).

async function testTransactionIntegrity() {
  await test('Transaction data integrity: no cross-transaction contamination', async () => {
    const sql = postgres({
      ...pgOptions,
      max: 3,
    })

    const errors = []

    try {
      await sql`CREATE TABLE IF NOT EXISTS race_test (id serial, val int)`
      await sql`TRUNCATE race_test`

      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          sql.begin(async tx => {
            await tx`INSERT INTO race_test (val) VALUES (${i})`
            const [{ count }] = await tx`SELECT count(*)::int as count FROM race_test WHERE val = ${i}`
            return { i, count }
          }).catch(e => { errors.push(e); return { i, error: e.code } })
        )
      )

      await sql`DROP TABLE IF EXISTS race_test`
      await sql.end({ timeout: 2 }).catch(() => {})

      const unsafeErrors = errors.filter(e => e.code === 'UNSAFE_TRANSACTION')
      assert(
        unsafeErrors.length === 0,
        `Got ${unsafeErrors.length} UNSAFE_TRANSACTION error(s)`
      )

      // Each transaction should see exactly 1 row with its value
      const badResults = results.filter(r => !r.error && r.count !== 1)
      assert(
        badResults.length === 0,
        `${badResults.length} transaction(s) saw wrong count: ` +
        badResults.slice(0, 3).map(r => `tx${r.i} saw ${r.count}`).join(', ')
      )
    } finally {
      await sql.end({ timeout: 1 }).catch(() => {})
    }
  })
}

// ─── Run ────────────────────────────────────────────────────────────────────

async function canConnect() {
  return new Promise(resolve => {
    const sql = postgres({ ...pgOptions, max: 1 })
    sql`SELECT 1`
      .then(() => sql.end().then(() => resolve(true)))
      .catch(() => { sql.end({ timeout: 0 }).catch(() => {}); resolve(false) })
  })
}

async function run() {
  console.log('\n  Race Condition Tests\n')

  const dbAvailable = await canConnect()
  if (!dbAvailable) {
    console.log('  SKIP: PostgreSQL not available (need postgres_js_test db/user)')
    console.log('  Set up with: createuser postgres_js_test && createdb -O postgres_js_test postgres_js_test\n')
    process.exit(1)
  }

  await testPipelineOverflow()
  await testConnectionExclusivity()
  await testStress()
  await testLowPipelineStress()
  await testTransactionIntegrity()

  console.log(`\n  Results: ${passCount} passed, ${failCount} failed out of ${testCount}\n`)

  process.exit(failCount > 0 ? 1 : 0)
}

run().catch(e => {
  console.error('Test runner error:', e)
  process.exit(1)
})
