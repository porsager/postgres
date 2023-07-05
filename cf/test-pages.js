// Add your database url and run this file with
// npx wrangler pages dev ./cf --script-path test-pages.js  --compatibility-date=2023-06-20 --log-level=debug --compatibility-flag=nodejs_compat
import postgres from './src/index'
const DATABASE_URL = ''

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname.includes('/favicon.ico')) {
            return new Response('')
        }
        if (url.pathname.startsWith('/')) {
            const sql = postgres(DATABASE_URL)
            const rows = await sql`SELECT table_name FROM information_schema.columns`
            return new Response(rows.map((e) => e.table_name).join('\n'))
        }

        // Otherwise, serve the static assets.
        // Without this, the Worker will error and no assets will be served.
        return env.ASSETS.fetch(request)
    },
}