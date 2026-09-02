// Reproduces UNSAFE_TRANSACTION under concurrent sql.begin().
// See https://github.com/porsager/postgres/issues/823

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

const ITERATIONS = 20;

async function runOnce() {
  const errors = [];
  const sql = postgres({ ...pgOptions, max: 3, max_pipeline: 2 });

  try {
    await sql`SELECT 1`;

    const blockers = Array.from({ length: 3 }, () =>
      sql`SELECT pg_sleep(0.5)`.catch((e) => { errors.push(e); return e; }),
    );
    await delay(10);

    const queries = Array.from({ length: 6 }, (_, i) =>
      sql`SELECT ${i}::int`.catch((e) => { errors.push(e); return e; }),
    );
    const begins = Array.from({ length: 5 }, (_, i) =>
      sql.begin(async (tx) => {
        await tx`SELECT ${i}::int as n`;
        return "ok";
      }).catch((e) => { errors.push(e); return e; }),
    );

    await Promise.allSettled([
      ...blockers,
      ...queries.map((p) => Promise.race([p, delay(10000).then(() => { throw new Error("timeout"); })])),
      ...begins.map((p) => Promise.race([p, delay(10000).then(() => { throw new Error("timeout"); })])),
    ]);
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }

  return errors.filter((e) => e.code === "UNSAFE_TRANSACTION").length;
}

async function run() {
  console.log("\n  Race Condition Test");
  console.log(`  Running scenario ${ITERATIONS} times to expose the race\n`);

  const dbAvailable = await canConnect();
  if (!dbAvailable) {
    console.log("  SKIP: PostgreSQL not available (need postgres_js_test db/user)");
    console.log("  Set up with: createuser postgres_js_test && createdb -O postgres_js_test postgres_js_test\n");
    process.exit(1);
  }

  let totalUnsafe = 0;
  let iterationsWithErrors = 0;

  for (let i = 0; i < ITERATIONS; i++) {
    const count = await runOnce();
    if (count > 0) {
      iterationsWithErrors++;
      totalUnsafe += count;
      process.stdout.write("\x1b[31mF\x1b[0m");
    } else {
      process.stdout.write("\x1b[32m.\x1b[0m");
    }
  }
  console.log("");

  if (totalUnsafe > 0) {
    console.log(`\n  \x1b[31mFAIL\x1b[0m ${totalUnsafe} UNSAFE_TRANSACTION error(s) across ${iterationsWithErrors}/${ITERATIONS} iterations\n`);
    process.exit(1);
  } else {
    console.log(`\n  \x1b[32mPASS\x1b[0m No UNSAFE_TRANSACTION errors across ${ITERATIONS} iterations\n`);
    process.exit(0);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
