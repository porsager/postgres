# Cloudflare Workers tests

`worker.js` is a Worker that runs a set of checks with Postgres.js (`../../src/cf.js`) and answers with
the result of each as JSON, with `failed` counting the ones that did not pass. It runs in three ways.

## 1. workerd, direct to PostgreSQL (every commit)

```sh
sh tests/cf/run.sh
```

`wrangler dev` runs the Worker in workerd on this machine, and it connects straight to the test
server on localhost: plain, md5, scram, TLS through `startTls`, and that `sslnegotiation: 'direct'`
is refused. Workers always verify certificates, so the TLS checks need the server to have a
certificate for `localhost` that `NODE_EXTRA_CA_CERTS` trusts; the `cloudflare` workflow makes one.
`ONLY=trust` runs the checks of one configuration.

## 2. workerd, through the Hyperdrive binding (every commit)

```sh
CHECK=hyperdrive sh tests/cf/run.sh
```

The same checks through `env.HYPERDRIVE.connectionString`, as a Worker using Hyperdrive would.
In `wrangler dev` the binding connects straight to `localConnectionString` in `wrangler.toml` (or the
`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` variable), so this checks the code path
but not Hyperdrive itself: no pooling and no caching.

## 3. A deployed Worker through a real Hyperdrive (scheduled)

The `hyperdrive` workflow runs every night and on demand. It deploys `worker.js` under a name of
its own, with the Hyperdrive id swapped in, calls `/hyperdrive` on its workers.dev URL, and deletes
the Worker again. A random token, passed as a variable and checked on every request, keeps anyone
else from running queries through it while it exists.

It needs, once:

1. A PostgreSQL server Cloudflare can reach, with TLS: a managed one (Neon, Supabase, RDS, ...)
   or one of your own with a public address. The checks create only temporary tables, so a user
   with no other rights than to connect and use temporary tables is enough.
2. A Hyperdrive configuration for it, made with
   `npx wrangler hyperdrive create postgres-js-ci --connection-string="postgres://user:password@host:5432/database"`.
   Its id is printed.
3. An API token for the account, with permission to edit Workers (the "Edit Cloudflare Workers"
   template) and to read Hyperdrive, and a workers.dev subdomain on the account.
4. Three repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `HYPERDRIVE_ID`.

Without the secrets the workflow skips itself. It can also be run by hand from the Actions tab.

`wrangler dev --remote` with the same configuration runs the Worker on Cloudflare through the real
Hyperdrive too, without deploying, which is handy for trying a change by hand.
