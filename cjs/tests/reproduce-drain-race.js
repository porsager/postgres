/**
 * Reproduction script for UNSAFE_TRANSACTION race condition.
 *
 * ROOT CAUSE: In connection.js execute() (lines 173-177):
 *
 *   return write(toBuffer(q))                                    // (A)
 *     && !q.describeFirst                                        // (B)
 *     && !q.cursorFn                                             // (C)
 *     && sent.length < max_pipeline                              // (D) ← KEY
 *     && (!q.options.onexecute || q.options.onexecute(connection)) // (E)
 *
 * When a BEGIN query is PIPELINED onto a busy connection:
 *   1. query is active (connection is busy), so BEGIN is pushed to sent[]
 *   2. write() returns true (BEGIN is small, < 1024 bytes)
 *   3. If sent.length >= max_pipeline, condition (D) is FALSE
 *   4. Short-circuit: onexecute at (E) NEVER FIRES
 *   5. connection.reserved is never set
 *   6. PostgreSQL processes BEGIN → CommandComplete('BEGIN')
 *   7. Check: result.command === 'BEGIN' && max !== 1 && !connection.reserved
 *   8. → UNSAFE_TRANSACTION thrown!
 *
 * In production (max_pipeline=100): under high concurrency with many
 * pipelined queries, sent[] grows past 100. The analysis proved write()
 * can't short-circuit for BEGIN, but missed the max_pipeline condition.
 *
 * Usage: export PATH="/usr/local/opt/postgresql@15/bin:$PATH" && node tests/reproduce-drain-race.js
 */

const postgres = require('../src/index.js')

const delay = ms => new Promise(r => setTimeout(r, ms))

const pgOptions = {
  db: 'postgres_js_test',
  user: 'postgres_js_test',
  idle_timeout: null,
  connect_timeout: 10,
}

async function canConnect() {
  return new Promise(resolve => {
    const sql = postgres({ ...pgOptions, max: 1 })
    sql`SELECT 1`
      .then(() => sql.end().then(() => resolve(true)))
      .catch(() => { sql.end({ timeout: 0 }).catch(() => {}); resolve(false) })
  })
}

// ─── Test 1: Direct reproduction with max_pipeline: 1 ───────────────────────
//
// With max_pipeline: 1, any BEGIN pipelined onto a busy connection will have
// sent.length >= 1, skipping onexecute. We need to ensure connections are
// busy so BEGIN gets pipelined (not dispatched to an idle connection).

async function testPipelineShortCircuit() {
  console.log('  Test 1: max_pipeline=1, forced pipelining via max:1\n')

  const errors = []
  let unsafeCount = 0

  // max: 1 forces ALL queries through one connection.
  // Under concurrent load, queries pile up in sent[].
  // When begin() fires, its BEGIN gets pipelined → sent.length >= 1 → skip onexecute.
  const sql = postgres({
    ...pgOptions,
    max: 2,        // max > 1 required for UNSAFE_TRANSACTION check
    max_pipeline: 1,
  })

  try {
    await sql`SELECT 1`

    const promises = []

    // Fire many regular queries + transactions concurrently
    for (let i = 0; i < 30; i++) {
      promises.push(
        sql`SELECT ${i}::int`.catch(e => {
          if (e.code === 'UNSAFE_TRANSACTION') unsafeCount++
          errors.push(e)
          return e
        })
      )

      if (i % 3 === 0) {
        promises.push(
          sql.begin(async tx => {
            await tx`SELECT ${i}::int as n`
            return 'ok'
          }).catch(e => {
            if (e.code === 'UNSAFE_TRANSACTION') unsafeCount++
            errors.push(e)
            return e
          })
        )
      }
    }

    await Promise.allSettled(
      promises.map(p => Promise.race([p, delay(15000).then(() => { throw new Error('timeout') })]))
    )

    await sql.end({ timeout: 2 }).catch(() => {})

    if (unsafeCount > 0) {
      console.log(`  \x1b[31mREPRODUCED: ${unsafeCount} UNSAFE_TRANSACTION error(s)\x1b[0m`)
      console.log('  Pipeline short-circuit skipped onexecute for BEGIN.\n')
      return true
    } else {
      console.log(`  Not triggered (errors: ${errors.length})\n`)
      return false
    }
  } catch (e) {
    console.error('  Error:', e.message)
    await sql.end({ timeout: 1 }).catch(() => {})
    return false
  }
}

// ─── Test 2: Stress with low max_pipeline ───────────────────────────────────

async function testStressLowPipeline() {
  console.log('  Test 2: Stress with max_pipeline=2 (reliable reproduction)\n')

  let totalUnsafe = 0
  let totalErrors = 0

  for (let round = 0; round < 5; round++) {
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
        promises.push(sql`SELECT ${i}::int`.catch(e => { errors.push(e); return e }))

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
        promises.map(p => Promise.race([p, delay(15000).then(() => { throw new Error('timeout') })]))
      )

      await sql.end({ timeout: 2 }).catch(() => {})

      const unsafeErrors = errors.filter(e => e.code === 'UNSAFE_TRANSACTION')
      totalUnsafe += unsafeErrors.length
      totalErrors += errors.length

      if (unsafeErrors.length > 0) {
        console.log(`    Round ${round + 1}: ${unsafeErrors.length} UNSAFE_TRANSACTION`)
      } else {
        console.log(`    Round ${round + 1}: no UNSAFE_TRANSACTION (${errors.length} other errors)`)
      }
    } catch (e) {
      await sql.end({ timeout: 1 }).catch(() => {})
    }
  }

  if (totalUnsafe > 0) {
    console.log(`\n  \x1b[31mREPRODUCED: ${totalUnsafe} total UNSAFE_TRANSACTION across 5 rounds\x1b[0m\n`)
    return true
  } else {
    console.log(`\n  Not triggered (${totalErrors} total errors)\n`)
    return false
  }
}

// ─── Test 3: High concurrency with default max_pipeline ─────────────────────
//
// With max_pipeline: 100 (default), we need 100+ pipelined queries on a
// single connection.

async function testHighConcurrencyPipeline() {
  console.log('  Test 3: High concurrency, default max_pipeline=100, max=2\n')

  let totalUnsafe = 0
  let totalErrors = 0

  for (let round = 0; round < 3; round++) {
    const errors = []

    const sql = postgres({
      ...pgOptions,
      max: 2,
      // default max_pipeline: 100
    })

    try {
      await sql`SELECT 1`

      const promises = []

      // Need 100+ concurrent queries on 2 connections to overflow pipeline.
      // Fire 300 queries + 50 begins rapidly.
      for (let i = 0; i < 300; i++) {
        promises.push(
          sql`SELECT ${i}::int`.catch(e => { errors.push(e); return e })
        )

        if (i % 6 === 0) {
          promises.push(
            sql.begin(async tx => {
              await tx`SELECT ${i}::int as n`
              return 'ok'
            }).catch(e => { errors.push(e); return e })
          )
        }
      }

      await Promise.allSettled(
        promises.map(p => Promise.race([p, delay(30000).then(() => { throw new Error('timeout') })]))
      )

      await sql.end({ timeout: 2 }).catch(() => {})

      const unsafeErrors = errors.filter(e => e.code === 'UNSAFE_TRANSACTION')
      totalUnsafe += unsafeErrors.length
      totalErrors += errors.length

      console.log(`    Round ${round + 1}: ${unsafeErrors.length} UNSAFE_TRANSACTION (${errors.length} total errors)`)
    } catch (e) {
      await sql.end({ timeout: 1 }).catch(() => {})
    }
  }

  if (totalUnsafe > 0) {
    console.log(`\n  \x1b[31mREPRODUCED with default max_pipeline: ${totalUnsafe} total UNSAFE_TRANSACTION\x1b[0m\n`)
    return true
  } else {
    console.log(`\n  Not triggered with default max_pipeline (may need more concurrency)\n`)
    return false
  }
}

// ─── Run ────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n  UNSAFE_TRANSACTION Reproduction\n')
  console.log('  Root cause: execute() short-circuit skips onexecute when')
  console.log('  sent.length >= max_pipeline during BEGIN pipelining.\n')

  const ok = await canConnect()
  if (!ok) {
    console.log('  SKIP: PostgreSQL not available')
    console.log('  Set up with: createuser postgres_js_test && createdb -O postgres_js_test postgres_js_test')
    process.exit(1)
  }

  let reproduced = false

  reproduced = await testPipelineShortCircuit() || reproduced
  reproduced = await testStressLowPipeline() || reproduced
  reproduced = await testHighConcurrencyPipeline() || reproduced

  if (reproduced) {
    console.log('  ========================================')
    console.log('  UNSAFE_TRANSACTION successfully reproduced on localhost!')
    console.log('  ========================================\n')
    process.exit(0)
  } else {
    console.log('  Could not reproduce.\n')
    process.exit(1)
  }
}

run().catch(e => { console.error(e); process.exit(1) })
