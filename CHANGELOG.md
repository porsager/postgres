# Changelog

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
