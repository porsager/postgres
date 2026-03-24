/**
 * Race Condition Test for UNSAFE_TRANSACTION in postgres.js
 *
 * Root cause: execute()'s short-circuit evaluation in connection.js skips
 * the onexecute callback (which sets connection.reserved) when
 * sent.length >= max_pipeline during query pipelining.
 *
 * Strategy: hold ALL connections busy with pg_sleep, then fire queries +
 * BEGINs. With max_pipeline: 2, the first pipelined query keeps the
 * connection in the busy queue. When a BEGIN is pipelined as the 2nd query,
 * sent.length >= max_pipeline → onexecute skipped → UNSAFE_TRANSACTION.
 *
 * Should FAIL on unfixed code and PASS after the fix.
 *
 * Usage:
 *   export PATH="/usr/local/opt/postgresql@15/bin:$PATH"
 *   node tests/race-condition.js
 *
 * Setup:
 *   createuser postgres_js_test
 *   createdb -O postgres_js_test postgres_js_test
 */

import postgres from "../src/index.js";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const pgOptions = {
  db: "postgres_js_test",
  user: "postgres_js_test",
  idle_timeout: null,
  connect_timeout: 10,
};

async function canConnect() {
  return new Promise((resolve) => {
    const sql = postgres({ ...pgOptions, max: 1 });
    sql`SELECT 1`
      .then(() => sql.end().then(() => resolve(true)))
      .catch(() => {
        sql.end({ timeout: 0 }).catch(() => {});
        resolve(false);
      });
  });
}

async function run() {
  console.log("\n  Race Condition Test\n");

  const dbAvailable = await canConnect();
  if (!dbAvailable) {
    console.log(
      "  SKIP: PostgreSQL not available (need postgres_js_test db/user)",
    );
    console.log(
      "  Set up with: createuser postgres_js_test && createdb -O postgres_js_test postgres_js_test\n",
    );
    process.exit(1);
  }

  const errors = [];

  const sql = postgres({
    ...pgOptions,
    max: 3,
    max_pipeline: 2,
  });

  try {
    await sql`SELECT 1`;

    // Hold ALL 3 connections busy
    const blockers = Array.from({ length: 3 }, () =>
      sql`SELECT pg_sleep(1)`.catch((e) => {
        errors.push(e);
        return e;
      }),
    );
    await delay(10);

    // Fire regular queries to fill pipelines, then BEGINs
    const queries = Array.from({ length: 6 }, (_, i) =>
      sql`SELECT ${i}::int`.catch((e) => {
        errors.push(e);
        return e;
      }),
    );
    const begins = Array.from({ length: 5 }, (_, i) =>
      sql
        .begin(async (tx) => {
          await tx`SELECT ${i}::int as n`;
          return "ok";
        })
        .catch((e) => {
          errors.push(e);
          return e;
        }),
    );

    // Wait for all to settle with a timeout to prevent hanging
    await Promise.allSettled([
      ...blockers,
      ...queries.map((p) =>
        Promise.race([
          p,
          delay(15000).then(() => {
            throw new Error("timeout");
          }),
        ]),
      ),
      ...begins.map((p) =>
        Promise.race([
          p,
          delay(15000).then(() => {
            throw new Error("timeout");
          }),
        ]),
      ),
    ]);

    await sql.end({ timeout: 2 }).catch(() => {});

    const unsafeErrors = errors.filter((e) => e.code === "UNSAFE_TRANSACTION");

    if (unsafeErrors.length > 0) {
      console.log(
        `  \x1b[31mFAIL\x1b[0m Got ${unsafeErrors.length} UNSAFE_TRANSACTION error(s)\n`,
      );
      process.exit(1);
    } else {
      console.log("  \x1b[32mPASS\x1b[0m No UNSAFE_TRANSACTION errors\n");
      process.exit(0);
    }
  } catch (e) {
    console.error("  Error:", e.message);
    await sql.end({ timeout: 1 }).catch(() => {});
    process.exit(1);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
