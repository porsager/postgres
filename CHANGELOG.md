# Changelog

## [3.0.5] - 6 Apr 2022
- Add optional onlisten function to listen  04569f9
- Fix dynamic in() helper after insert - fixes #305  f1ebe2f
- Ensure drain only dequeues if ready - fixes #303  2e5f017

## [3.0.4] - 5 Apr 2022
- Ensure drain only dequeues if ready - fixes #303  2e5f017

## [3.0.3] - 4 Apr 2022
- Run tests with github actions  b536d0d
- Add custom socket option - fixes #284  5413f0c
- Fix sql function overload type inference (#294)  3c4e90a
- Update deno std to 0.132 and enable last tests  50762d4
- Send proper client-encoding - Fixes #288  e5b8554

## [3.0.2] - 31 Mar 2022
- Fix BigInt handling  36a70df
- Fix unsubscribing  (#300)  b6c597f
- Parse update properly with identity full - Fixes #296  3ed11e7

## [3.0.1] - 30 Mar 2022
 - Improve connection queue handling + fix leak cee1a57
 - Use publications option - fixes #295 b5ceecc
 - Throw proper query error if destroyed e148a0a
 - Transaction rejects with rethrown error - fixes #289 f7c8ae6
 - Only create origin stacktrace for tagged and debug - fixes #290 a782edf
 - Include types and readme in deno release - fixes #287 9068820
 - Disable fetch_types for Subscribe options 72e0cdb
 - Update TypeScript types with v3 changes (#293) db05836

## [3.0.0] - 24 Mar 2022
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

## [1.0.2] - 21 Jan 2020

- Fix standard postgres user env var (#20)  cce5ad7
- Ensure url or options is not falsy  bc549b0
- Add support for dynamic password  b2ab9fb
- Fix hiding pass from options  3f76b98


## [1.0.1] - 3 Jan 2020

- Fix #3 url without db and trailing slash  45d4233
- Fix stream promise - resolve with correct result  730df2c
- Fix return value of unsafe query with multiple statements  748f198
- Fix destroy before connected  f682ca1
- Fix params usage for file() call without options  e4f12a4
- Various Performance improvements

## [1.0.0] - 22 Dec 2019

- Initial release
