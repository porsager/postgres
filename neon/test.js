// Add your database url and run this file with the below two commands to test pages and workers
// npx wrangler@latest pages dev ./neon --script-path test.js  --compatibility-date=2023-06-20 --log-level=debug --compatibility-flag=nodejs_compat
// npx wrangler@latest dev ./neon/test.js --compatibility-date=2023-06-20 --log-level=debug --compatibility-flag=nodejs_compat

import postgres from "./src/index.js";
const DATABASE_URL = "";

export default {
  async fetch(r, e, ctx) {
    const sql = postgres(DATABASE_URL);
    const rows = await sql`SELECT table_name FROM information_schema.columns`;
    return new Response(rows.map((e) => e.table_name).join("\n"));
  },
};
