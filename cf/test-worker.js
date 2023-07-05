// Add your database url and run this file with
// npx wrangler dev ./cf/test-worker.js --compatibility-date=2023-06-20 --log-level=debug --compatibility-flag=nodejs_compat
import postgres from './src/index'
const DATABASE_URL = ''

export default {
    async fetch(request, env, ctx) {
        if (request.url.includes('/favicon.ico'))
            return new Response()

        const sql = postgres(DATABASE_URL)
        const rows = await sql`SELECT table_name FROM information_schema.columns`
        return new Response(rows.map((e) => e.table_name).join('\n'))
    },
}