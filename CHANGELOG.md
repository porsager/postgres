# Changelog

## v4.0.0

v4 rewrites everything below the public API: the pool, the connection, the protocol, startup and the socket layer. Queries, helpers, transactions, cursors, COPY, listen, subscribe, large objects and the options work as in 3.4.9, apart from the changes below.

### Security

- **A NUL character in a connection parameter can no longer add parameters** (also in v3). A `database`, `user` or `connection` value such as `'db\0user\0postgres'` was sent as further startup parameters, so an app that put untrusted input there, as with a database per tenant, could be made to log in as another user where that user needs no password, or with `replication` or `options` set. A NUL in any protocol string, also in query text and identifiers, now rejects with `NUL_CHARACTER`.
- **A column named `__proto__` is an own property** (also in v3). It became the prototype of the row, so a JSON value in it, for instance from a column alias built from user input, made the row inherit its properties (`row.isAdmin`), in query results and in `sql.subscribe` rows alike.

### Upgrading from v3

The README has an [upgrade guide](./README.md#upgrading-from-v3), with a query that shows whether the change in parameter types concerns you.

- **The server decides the type of every parameter (`infer: false` by default)** (#392). v3 typed a `Date` as `timestamptz`, a boolean, a `Buffer`, a `bigint` and arrays of these from JavaScript; v4 sends them without a type and writes each value for the type the server asks for, as libpq does. `timestamptz` columns, values written to a column of their own type, strings, numbers and anything cast work as before. Outside UTC, a `Date` written to or compared with a `timestamp` or `date` column is taken as UTC instead of the session's local time, and a `timestamp` is read as UTC, so it comes back as the instant that was written whatever the time zone. A `Date` where the query doesn't decide its type, such as in `date_trunc('day', ${ date })`, needs a cast (`${ date }::timestamptz`). `infer: true` keeps v3's behaviour.
- **Runtimes.** Node.js 20 or later, Bun, and Cloudflare Workers; Deno through its Node.js compatibility. The CommonJS and Deno builds are gone: Postgres.js is an ES module, which `require` can load on Node.js 20.19 and 22.12 and later (`require('postgres').default`).
- **`sql.array()` is removed.** Pass the array as it is, with a cast where the query doesn't decide its type: `${ ids }::int[]`. Calling `sql.array()` throws `ARRAY_REMOVED`.
- **A transaction the server rolled back rejects.** When the server answers COMMIT with ROLLBACK, `sql.begin` rejects with `TRANSACTION_ROLLED_BACK`; v3 took it as a commit.
- **A released connection stays released.** A query on a reserved `sql` after `release()`, or on a transaction's `sql` after it has committed or rolled back, rejects; v3 ran it on whatever connection it then had. Releasing a reserved connection while its own `BEGIN` is still open closes it instead of returning an open transaction to the pool.
- **An unsafe `begin`** outside `sql.begin`, a reserved connection or `max: 1` rejects with `UNSAFE_TRANSACTION` and is rolled back. A query that looks like it may open a transaction runs alone on its connection, so nothing else lands in it, and any query that leaves its connection in a transaction is rolled back and rejected. v3 rejected `BEGIN` but left the transaction open. A script that opens and closes its own transaction in one query, such as a migration file with `BEGIN` and `COMMIT`, runs; v3 ran it and still rejected it.
- **A query that cannot be built or serialized inside a transaction aborts the transaction**, in `sql.begin` (#1236, #1238) or one opened by hand on a reserved connection, just as a server error would: the queries after it fail with `25P02` and a later `COMMIT` answers `ROLLBACK`. v3 skipped the query and let the rest commit.
- **Domains** that exist when the pool starts are read and written as their base type, so a domain over `int[]` comes back as an array of numbers; v3 returned the text.
- **A connection refused for too many connections (`53300`) is retried** with `backoff` until `connect_timeout` has passed, and the waiting queries reject with that error only then. Such a refusal is often momentary: connections opened at the same time against a connection limit can all be refused while the server counts them. v3 rejected the queries of the refused connection at once.
- **No host matching `target_session_attrs`** rejects with `CONNECTION_DESTROYED` instead of retrying forever.
- **An unknown authentication type rejects** with `AUTH_TYPE_NOT_IMPLEMENTED` instead of waiting for the connect timeout.
- **A replication error with no `onerror` is logged.** When the `sql.subscribe` stream fails and none of its subscriptions has an `onerror`, the error goes to `console.error` before the stream reconnects; v3 dropped it. Pass `onerror` to handle or silence it.
- **`infinity` timestamps** are `Infinity` and `-Infinity`, both ways, instead of an invalid `Date`.
- **TypeScript:** the types are an ES module with a default export and named types (`import postgres, { type Sql } from 'postgres'`). A reserved connection is no longer typed as having `begin` and `end`, which it never had.

### New

- **Scheduling across connections:** when every connection is busy, a query is pipelined on the connection where it should be done soonest, from how long each statement took before and how long what is in flight has run, and slow queries are kept together once the rest of the pool is needed for quick ones. In simulations of mixed workloads, the p99 of quick queries fell 2 to 100 times; on PostgreSQL, a 1 ms lookup no longer waits behind a report on a busy pool (p99.9 from 792 ms to 5 ms). `scheduler: false` pipelines on the busy connection with the fewest queries in flight instead; v3 went round-robin over the busy connections. With `max: 1` it is off, as there is only one connection.
- **`queue_timeout`:** seconds a query, transaction or reserve may wait for a connection before it rejects with `QUEUE_TIMEOUT`, unsent (#1036, #824).
- **`.signal(abortSignal)`** on a query: aborting rejects it if it is still waiting, or cancels it if it is running.
- **Canceling a cursor between batches stops it.** `.cancel()` or an aborted `.signal()` while the cursor's callback runs, or while an async iterator over it is between batches, fetches no more rows, closes the portal and rejects with `57014`. v3 sent a cancel request that the idle server ignored, so the cursor ran on to the end (or, arriving late, could cancel the next query).
- **``sql` and `.join(items)``** joins fragments and values with a fragment as separator, leaving out falsy items and adding spaces where missing (#807, #813).
- **Nested `sql.begin`** inside a transaction runs in a savepoint (#985).
- **`sql.rollback()`** rolls back a transaction, or the savepoint it is called in, without throwing; `sql.begin` resolves with the callback's result (#500).
- **Pipelining anywhere in a transaction** is documented and tested: queries in a `Promise.all` between awaited ones are sent together and run in the order they were made (#951).
- **Custom types by name:** `to` and `from` can be type names, looked up when the pool starts, with array types, for extension types such as pgvector (#1115, #719).
- **`using` and `await using`:** `sql` ends the pool and a reserved connection is released when it goes out of scope (#886, #1094).
- **`unref_sockets: true`** lets the process exit while connections are idle, like `allowExitOnIdle` in node-postgres (#869, #918).
- **`min`:** connections kept open once the pool is used; `idle_timeout` closes only those above it (#672).
- **`user` as a function**, called each time a connection opens, like `password`, for credentials that rotate (#881).
- **Password file:** with no password given, `PGPASSFILE` or `~/.pgpass` is read as libpq reads it (#964).
- **Named arguments:** an object in the parentheses of a function call becomes `name => value` arguments, `make_interval(${ sql({ days: 1 }) })` (#1040).
- **Errors** are documented with their fields and how to tell them apart (#1140).
- **COPY row count:** a `copy ... from stdin` writable has `count` and `command` once it has finished, with the number of rows the server copied (#465).
- **Persistent replication slots:** `slot: 'name'` keeps the slot of `sql.subscribe` across restarts and streams from where it was last confirmed. A transaction is confirmed only once its handlers have finished, a handler that fails gets its transaction delivered again, and handlers may be async: they run one after the other in commit order while the stream waits.
- **More from `sql.subscribe`:** `truncate` events, and the `lsn`, `time` and `xid` of the transaction on every change. Reconnecting retries with backoff.
- **Channel binding:** over TLS, SCRAM authenticates with SCRAM-SHA-256-PLUS (`tls-server-end-point`) when the server offers it, binding the login to the server certificate. `channel_binding` is `'prefer'` by default, `'require'` or `'disable'` as in libpq, also from the url or `PGCHANNELBINDING`; `'require'` rejects an unbound connection with `CHANNEL_BINDING_REQUIRED` (#1008).
- **Direct TLS on Node.js** with `sslnegotiation: 'direct'` (PostgreSQL 17+) is opened as TLS from the first byte and is the fastest encrypted connection.
- **Cloudflare Workers** through the `workerd` export condition, on `cloudflare:sockets`, with TLS by `startTls`.
- **`query.text` and `query.parameters`** show the text and values a query will be sent with, before it is sent.
- **`sql.stats`**: connections, opening, idle, leased and waiting, right now.
- **Tracing channels:** `postgres:query`, `postgres:connect` and `postgres:transaction` as diagnostics tracing channels, and `postgres:pool` and `postgres:notice` as plain channels, for OpenTelemetry and other tracers without an option or a wrapper. Nothing is published, and nothing costs, without a subscriber. See [Tracing](./README.md#tracing).
- **Prepared statements are prepared again when a column changes type.** A query that the statement's parameter types no longer fit fails before it runs; it is now run once more with a fresh description and the statement prepared again, outside a transaction or reserved connection. On a pool of more than one connection that holds also while other queries are in flight; with `max: 1` only for a query that is alone on the connection, so queries keep their order. v3 kept failing until the connection was replaced. Each connection reads rows and writes values only by what its own server described for the statement. When one connection sees a statement describe differently, the others prepare it again before their next use instead of trusting what they learned before.
- **`sql.close()`** closes the connections once their queries are done and leaves the pool usable.
- **Named cursors:** in a transaction or on a reserved connection every cursor has a portal of its own, so several can be open at once.
- **Stack traces** of query errors lead to the line that made the query. Only the text of that line is kept, once per place in the code, so the function that made the query is not kept alive with it (#1274, #1276).
- **`options.socket`** is also called with the host and port, and a socket can say it has done TLS itself (`negotiated: true`).
- **`onread: false`** reads through the socket stream instead of a shared buffer, should a runtime ever misbehave with it.

### Fixed

The open issues and pull requests were triaged into 33 correctness bugs, each with a regression test in the v4 suite. Among them:

- **One query on a cold pool opens one connection**, not one more for each connection that opens while the first loads types.
- **Errors:** the server's data type field is `data_type_name`; v3 set it as `'data type_name'`, with a space, and typed it as `type_name`. `JSON.stringify` of a `PostgresError` includes its message (#767, #1132).
- **Cursors:** the callback of the last batch is awaited before the cursor resolves, and a rejection from it rejects the cursor; v3 resolved without waiting and left the rejection unhandled. A callback that throws synchronously on a cursor in a transaction or on a reserved connection rejects the cursor and leaves the connection as it was; v3 gave the next query a malformed result.
- **Large objects:** `readable({ start, end })` stops at `end`; v3 ignored it and read to the end of the object.
- **Bun:** error stacks point at the calling line, as on Node; library frames were recognised only as `file://` urls.
- **Cloudflare Workers:** a TLS handshake that Workers cannot complete, most often a certificate not signed by a public CA, rejects with `TLS_HANDSHAKE_FAILED` instead of `CONNECTION_CLOSED` or `CONNECT_TIMEOUT` (#1213), and `perf_hooks` is no longer imported (#990). Writes are split into 16 KiB pieces, as Workers were reported to drop a plain connection on a larger write (#1268).
- **A statement name the server already has**, which a pooler that moves connections between clients can cause, is prepared again under a new name instead of failing with `42P05` (#960).
- **TypeScript:** `ISql` is exported for functions that take the pool, a transaction or a reserved connection (#1163, #1150); `PostgresError` is exported by name as a value as well as a type (#862, #703); nested arrays with `null` and other values in helpers (#743); a typed query with a helper inside (#958); column lists that are `string[]`, while unknown literal columns are still caught (#916); class instances and `object` as JSON (#664, #625); `null` and `false` for the timer options (#1178).
- **Helpers follow the clause they are in**, not the last keyword anywhere before them: `update t as x set ${ sql(o) }` (#974), `insert into t as x ${ sql(o) }` (#517, #774), `grant update on ${ sql(tables) }` (#1101), rows in `in (${ sql(rows) })` (#820), a column list for `insert into t ${ sql(columns) } select ...` (#769), objects in a `values` helper with picked columns, also inside a fragment (#1073, #1042), and fragments among the columns of `select ${ sql([...]) }` (#777). An insert or update helper without columns throws `NO_COLUMNS` instead of sending invalid SQL (#644). Several names outside a clause, `order by ${ sql('a', 'b') }`, become a list of identifiers; v3 threw a `TypeError`.
- **An array or a plain object written as text**, such as in a `values` list cast afterwards, is written as an array literal or as JSON instead of `1,2` or `[object Object]` (#741, #872, #765).
- **Connection urls:** bracketed IPv6 hosts (#1232), percent-encoded socket directories as hosts (#1057), `?host=` and `?port=` as libpq reads them (#984), and passwords with characters that are not percent-encoded, which are used as written (#735, #890).
- Answers can no longer reach the wrong query: after a cancel, a query that could not be built or serialized, or an error in the middle of a result, every query still gets its own answer. (A cancel that reaches the server just as its query finishes can still stop the next query on that connection; that is the protocol.)
- A transaction whose connection is lost rejects, and nothing it queued reaches the connection's next user.
- A cursor started in `sql.begin` and not awaited finishes before the transaction commits.
- Queries and transactions start in the order they were made: with `max: 1`, a query made before `sql.begin` runs before the transaction.
- While connections keep failing, queries and transactions reject at once with the connection error, each with its own error object, instead of waiting for the next attempt.
- A failed connection attempt only rejects the waiting queries when no other attempt is under way and no connection can still serve them, so a connection that is still loading types is waited for.
- A reserved connection released while its own queries are still in flight goes back to the pool only once they are answered and it is outside a transaction; otherwise it is closed.
- `connect_timeout` destroys a TCP connection that is still being opened, so the process can exit.
- A server that is ready before it has accepted the authentication is rejected with `AUTHENTICATION_INCOMPLETE`, so SCRAM cannot be skipped.
- An `onnotice` that throws during startup no longer fails the connection.
- `sql.subscribe` parses custom array types and domains like queries do.
- A custom serializer that returns something other than a string or a `Buffer` rejects its query, also in a cursor, instead of hanging the connection.
- A cursor on the pool or a reserved connection whose callback throws on the last batch, or whose column parser throws, rejects and frees its connection instead of hanging it.
- After `DEALLOCATE ALL`, a statement prepared again is not forgotten because of an older query's error.
- The same query text in schemas of different shape (a `search_path` per tenant, say) gets the rows of its own schema on every connection.
- `debug` gets the values as they are sent and the parameter types, also on the first use of a statement.
- The types of `sql.listen()` (`{ state, unlisten }`) and `sql.prepare()` (returns the name) match what they return.
- `notify` inside a transaction uses the transaction (#966).
- `null` in arrays (#1258), `Infinity` (#728), years below 100 and offsets in seconds (#1185).
- `PostgresError` from a plain message (#703) and writable stacks (#1227).
- Keywords next to helpers and fragments (#1221).
- `end()` stops connection attempts under way and settles every query; a reserved connection is never stranded.
- Array and domain types are fetched once per pool, on its first connection; if that query fails with a server error the pool carries on without them instead of asking again for every query.
- COPY under back-pressure no longer stalls, and COPY TO STDOUT to a slow consumer is no slower with the shared read buffer than without it.

### Performance

- A statement whose parameter types are all known is prepared, described and run in one round trip; one with parameters only the server can type is described first, once per connection, as in v3.
- `int2`, `int4`, `oid` and `bool` columns are decoded straight from the bytes when they use the built-in parsers; a custom parser still gets the text.
- A query on its way to a free connection goes straight to it, without the waiting queue.
- Queries hold no more per-query state than they need, so almost nothing outlives a scavenge.
- One growing buffer per connection, encoded in place and written once at the end of the tick.
- Plain and direct TLS connections read into one buffer per connection (`onread`) instead of a buffer per chunk, on Node, Bun and Deno.
- Rows, column descriptions and command tags are decoded by hand.
- Once a result shape has delivered 16 rows, its rows are read by a function compiled for that shape, which builds each row as one object literal with every column already in place (about half the CPU per row at 20 columns, about 12% less at 5). Where code generation is not allowed, rows are built as before.

### Testing

- Unit tests for the protocol, types, query building and errors (`node tests/unit`).
- A simulation that runs the real client against a fake server on a fake clock, with faults, checking that every query settles with its own answer (`node tests/simulate.js`).
- The integration suite in one file per area; CI runs it on PostgreSQL 14 to 18 and Node.js 20, 22 and 24.
- A test worker for Cloudflare Workers (`sh tests/cf/run.sh`) and a TypeScript test for the types (`cd types && npm test`).
- CI runs the unit, integration and simulation tests on Bun and Deno as well as Node.
- `npm run coverage` (`node tests/coverage.js`, `--lines` for the lines not run) runs the tests with Node's own V8 coverage and reports it per file in `src`, with no dependency; CI fails below `COVERAGE_MIN`.

## v3.2.4 - 25 May 2022
- Allow setting keep_alive: false  bee62f3
- Fix support for null in arrays - fixes #371  b04c853

## v3.2.3 - 23 May 2022
- Fix Only use setKeepAlive in Deno if available  28fbbaf
- Fix wrong helper match on multiple occurances  02f3854

#### Typescript related
- Fix Deno assertRejects compatibility (#365)  0f0af92
- Fix include missing boolean type in JSONValue union (#373)  1817387

## v3.2.2 - 15 May 2022
- Properly handle errors thrown on commit  99ddae4

## v3.2.1 - 15 May 2022
- Exclude target_session_attrs from connection obj  43f1442

## v3.2.0 - 15 May 2022
- Add `sslmode=verify-full` support  e67da29
- Add support for array of fragments  342bf55
- Add uri decode of host in url - fixes #346 1adc113
- Add passing of rest url params to connection (ootb support cockroach urls)  41ed84f
- Fix Deno partial writes  452a30d
- Fix `as` dynamic helper  3300c40
- Fix some nested fragments usage  9bfa902
- Fix missing columns on `Result` when using simple protocol - fixes #350  1e2e298
- Fix fragments in transactions - fixes #333  75914c7

#### Typescript related
- Upgrade/fix types (#357)  1e6d312
- Add optional `onlisten` callback to `listen()` on TypeScript (#360)  6b749b2
- Add implicit custom type inference (#361)  28512bf
- Fix and improve sql() helper types (#338)  c1de3d8
- Fix update query type def for `.writable()` and `.readable()` to return promises (#347)  51269ce
- Add bigint to typescript Serializable - fixes #330  f1e41c3

## v3.1.0 - 22 Apr 2022
- Add close method to close but not end connections forever  94fea8f
- Add .values() method to return rows as arrays of values  56873c2
- Support transform.undefined - fixes #314  eab71e5
- Support nested fragments values and dynamics - fixes #326  86445ca
- Fix deno close sequence  f76af24
- Fix subscribe reconnect and add onsubscribe method - fixes #315  5097345
- Deno ts fix - fixes #327  50403a1

## v3.0.6 - 19 Apr 2022
- Properly close connections in Deno  cbc6a75
- Only write end message if socket is open  13950af
- Improve query cancellation  01c2c68
- Use monotonically increasing time for timeout - fixes #316  9d7a21d
- Add support for dynamic columns with `returning` - fixes #317  04644c0
- Fix type errors in TypeScript deno projects (#313)  822fb21
- Execute forEach instantly  44e9fbe

## v3.0.5 - 6 Apr 2022
- Fix transaction execution timing  28bb0b3
- Add optional onlisten function to listen  1dc2fd2
- Fix dynamic in helper after insert #305  4d63a59

## v3.0.4 - 5 Apr 2022
- Ensure drain only dequeues if ready - fixes #303  2e5f017

## v3.0.3 - 4 Apr 2022
- Run tests with github actions  b536d0d
- Add custom socket option - fixes #284  5413f0c
- Fix sql function overload type inference (#294)  3c4e90a
- Update deno std to 0.132 and enable last tests  50762d4
- Send proper client-encoding - Fixes #288  e5b8554

## v3.0.2 - 31 Mar 2022
- Fix BigInt handling  36a70df
- Fix unsubscribing  (#300)  b6c597f
- Parse update properly with identity full - Fixes #296  3ed11e7

## v3.0.1 - 30 Mar 2022
 - Improve connection queue handling + fix leak cee1a57
 - Use publications option - fixes #295 b5ceecc
 - Throw proper query error if destroyed e148a0a
 - Transaction rejects with rethrown error - fixes #289 f7c8ae6
 - Only create origin stacktrace for tagged and debug - fixes #290 a782edf
 - Include types and readme in deno release - fixes #287 9068820
 - Disable fetch_types for Subscribe options 72e0cdb
 - Update TypeScript types with v3 changes (#293) db05836

## v3.0.0 - 24 Mar 2022
This is a complete rewrite to better support all the features that I was trying to get into v2. There are a few breaking changes from v2 beta, which some (myself included) was using in production, so I'm skipping a stable v2 release and going straight to v3.

Here are some of the new things available, but check the updated docs.
- Dynamic query builder based on raw sql
- Realtime subscribe to db changes through logical replication
- Multi-host support for High Availability setups
- Postgres input parameter types from `ParameterDescription`
- Deno support
- Cursors as async iterators
- `.describe()` to only get query input types and column definitions
- Support for Large Objects
- `max_lifetime` for connections
- Cancellation of requests
- Converted to ESM (with CJS support)
- Typescript support (Credit @minigugus)

### Breaking changes from v2 -> v3
- Cursors are always called with `Result` arrays (previously cursor 1 would return a row object, where > 1 would return an array of rows)
- `.writable()` and `.readable()` is now async (returns a Promise that resolves to the stream)
- Queries now returns a lazy promise instead of being executed immediately. This means the query won't be sent until awaited (.then, .catch, .finally is called) or until `.execute()` is manually called.
- `.stream()` is renamed to `.forEach`
- Returned results are now it's own `Result` class extending `Array` instead of an Array with extra properties (actually shouldn't be breaking unless you're doing something funny)
- Parameters are now cast using the types returned from Postgres ParameterDescription with a fallback to the previously inferred types
- Only tested with node v12 and up
- Implicit array value to multiple parameter expansion removed (use sql([...]) instead)

### Breaking changes from v1 -> v2 (v2 never moved on from beta)
- All identifiers from `sql()` in queries are now always quoted
- Undefined parameters are no longer allowed
- Rename timeout option to `idle_timeout`
- Default to 10 connections instead of number of CPUs
- Numbers that cannot be safely cast to JS Number are returned as string. This happens for eg, `select count(*)` because `count()` returns a 64 bit integer (int8), so if you know your `count()` won't be too big for a js number just cast in your query to int4 like `select count(*)::int`

## v1.0.2 - 21 Jan 2020

- Fix standard postgres user env var (#20)  cce5ad7
- Ensure url or options is not falsy  bc549b0
- Add support for dynamic password  b2ab9fb
- Fix hiding pass from options  3f76b98


## v1.0.1 - 3 Jan 2020

- Fix #3 url without db and trailing slash  45d4233
- Fix stream promise - resolve with correct result  730df2c
- Fix return value of unsafe query with multiple statements  748f198
- Fix destroy before connected  f682ca1
- Fix params usage for file() call without options  e4f12a4
- Various Performance improvements

## v1.0.0 - 22 Dec 2019

- Initial release
