<img align="left" width="440" height="180" alt="Fastest full PostgreSQL nodejs client" src="https://raw.githubusercontent.com/porsager/postgres/master/postgresjs.svg?sanitize=true">

- 🚀 Fastest full-featured PostgreSQL client
- 🏷 ES6 Tagged Template Strings at the core
- 🏄‍♀️ Simple surface API
- 🖊️ Dynamic query support
- 🐦 Follow on [X](https://x.com/rporsager)

<br>

## Getting started

<br>
<img height="220" width="458" alt="Good UX with Postgres.js" src="https://raw.githubusercontent.com/porsager/postgres/master/demo.gif">
<br>

### Installation
```bash
$ npm install postgres
```

Postgres.js needs Node.js 20 or later, Bun, or Cloudflare Workers. Deno runs it through its Node.js compatibility. It is an ES module with no dependencies.

> **Upgrading from v3?** The API is the same apart from a short list of changes. Read [Upgrading from v3](#upgrading-from-v3) first: parameter types are now decided by the server, which changes how a `Date` is written to `timestamp` and `date` columns outside UTC.

### Usage
Create your `sql` database instance
```js
// db.js
import postgres from 'postgres'

const sql = postgres({ /* options */ }) // will use psql environment variables

export default sql
```

Simply import for use elsewhere
```js
// users.js
import sql from './db.js'

async function getUsersOver(age) {
  const users = await sql`
    select
      name,
      age
    from users
    where age > ${ age }
  `
  // users = Result [{ name: "Walter", age: 80 }, { name: 'Murray', age: 68 }, ...]
  return users
}


async function insertUser({ name, age }) {
  const users = await sql`
    insert into users
      (name, age)
    values
      (${ name }, ${ age })
    returning name, age
  `
  // users = Result [{ name: "Murray", age: 68 }]
  return users
}
```

#### Dynamic imports and CommonJS

```js
const { default: postgres } = await import('postgres')
```

From CommonJS, on Node.js 20.19 or 22.12 and later, `require` loads it as well:

```js
const postgres = require('postgres').default
```

## Table of Contents

* [Upgrading from v3](#upgrading-from-v3)
* [Connection](#connection)
* [Queries](#queries)
* [Building queries](#building-queries)
* [Advanced query methods](#advanced-query-methods)
* [Transactions](#transactions)
* [Data Transformation](#data-transformation)
* [Listen & notify](#listen--notify)
* [Realtime subscribe](#realtime-subscribe)
* [Numbers, bigint, numeric](#numbers-bigint-numeric)
* [Result Array](#result-array)
* [Connection details](#connection-details)
* [Custom Types](#custom-types)
* [Teardown / Cleanup](#teardown--cleanup)
* [Tracing](#tracing)
* [Error handling](#error-handling)
* [TypeScript support](#typescript-support)
* [Reserving connections](#reserving-connections)
* [Changelog](./CHANGELOG.md)


## Connection

### `postgres([url], [options])`

You can use either a `postgres://` url connection string or the options to define your database connection properties. Options in the object will override any present in the url. Options will fall back to the same environment variables as psql.

```js
const sql = postgres('postgres://username:password@host:port/database', {
  host                 : '',            // Postgres ip address[s] or domain name[s]
  port                 : 5432,          // Postgres server port[s]
  database             : '',            // Name of database to connect to
  username             : '',            // Username of database user
  password             : '',            // Password of database user
  ...and more
})
```

More options can be found in the [Connection details section](#connection-details).

## Queries

### ```await sql`...` -> Result[]```

Postgres.js utilizes [Tagged template functions](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals#Tagged_templates) to process query parameters **before** interpolation. Using tagged template literals benefits developers by:

1. **Enforcing** safe query generation
2. Giving the ` sql`` ` function powerful [utility](#dynamic-inserts) and [query building](#building-queries) features.

Any generic value will be serialized according to an inferred type, and replaced by a PostgreSQL protocol placeholder `$1, $2, ...`. The parameters are then sent separately to the database which handles escaping & casting.

All queries will return a `Result` array, with objects mapping column names to each row.

```js
const xs = await sql`
  insert into users (
    name, age
  ) values (
    'Murray', 68
  )

  returning *
`

// xs = [{ user_id: 1, name: 'Murray', age: 68 }]
```

> Please note that queries are first executed when `awaited` – or instantly by using [`.execute()`](#execute).

### Query parameters

Parameters are automatically extracted and handled by the database so that SQL injection isn't possible. No special handling is necessary, simply use tagged template literals as usual.

```js
const name = 'Mur'
    , age = 60

const users = await sql`
  select
    name,
    age
  from users
  where
    name like ${ name + '%' }
    and age > ${ age }
`
// users = [{ name: 'Murray', age: 68 }]
```

> Be careful with quotation marks here. Because Postgres infers column types, you do not need to wrap your interpolated parameters in quotes like `'${name}'`. This will cause an error because the tagged template replaces `${name}` with `$1` in the query string, leaving Postgres to do the interpolation. If you wrap that in a string, Postgres will see `'$1'` and interpret it as a string as opposed to a parameter.

### Parameter types

The server decides the type of every parameter from the query, as with libpq and `psql`, and each value is written for the type the server asked for. A `Date` for a `timestamptz` or `timestamp` column is stored as the instant it is, a `timestamp` is read back as UTC, and a string such as `'true'` for a `boolean` is read by the server.

Where the query doesn't decide the type, such as a value in the select list or an argument to an overloaded function like `date_trunc`, the server reads the value as text or asks for a cast. A cast always decides:

```js
await sql`select date_trunc('day', ${ date }::timestamptz)`
await sql`select ${ flag }::bool as flag`
```

`infer: true` types values from JavaScript instead, as v3 did: a `Date` as `timestamptz`, a `Buffer` or `Uint8Array` as `bytea`, a boolean as `boolean`, a `bigint` as `int8`, and an array by its first element. See [Upgrading from v3](#upgrading-from-v3) for what that changes.

### Dynamic column selection

```js
const columns = ['name', 'age']

await sql`
  select
    ${ sql(columns) }
  from users
`

// Which results in:
select "name", "age" from users
```

### Dynamic inserts

```js
const user = {
  name: 'Murray',
  age: 68
}

await sql`
  insert into users ${
    sql(user, 'name', 'age')
  }
`

// Which results in:
insert into users ("name", "age") values ($1, $2)

// The columns can also be given with an array
const columns = ['name', 'age']

await sql`
  insert into users ${
    sql(user, columns)
  }
`
```

**You can omit column names and simply execute `sql(user)` to get all the fields from the object as columns**. Be careful not to allow users to supply columns that you do not want to be inserted.

#### Multiple inserts in one query
If you need to insert multiple rows at the same time it's also much faster to do it with a single `insert`. Simply pass an array of objects to `sql()`.

```js
const users = [{
  name: 'Murray',
  age: 68,
  garbage: 'ignore'
},
{
  name: 'Walter',
  age: 80
}]

await sql`insert into users ${ sql(users, 'name', 'age') }`

// Is translated to:
insert into users ("name", "age") values ($1, $2), ($3, $4)

// Here you can also omit column names which will use object keys as columns
await sql`insert into users ${ sql(users) }`

// Which results in:
insert into users ("name", "age") values ($1, $2), ($3, $4)
```

### Dynamic columns in updates
This is also useful for update queries
```js
const user = {
  id: 1,
  name: 'Murray',
  age: 68
}

await sql`
  update users set ${
    sql(user, 'name', 'age')
  }
  where user_id = ${ user.id }
`

// Which results in:
update users set "name" = $1, "age" = $2 where user_id = $3

// The columns can also be given with an array
const columns = ['name', 'age']

await sql`
  update users set ${
    sql(user, columns)
  }
  where user_id = ${ user.id }
`
```

### Multiple updates in one query
To create multiple updates in a single query, it is necessary to use arrays instead of objects to ensure that the order of the items correspond with the column names.
```js
const users = [
  [1, 'John', 34],
  [2, 'Jane', 27],
]

await sql`
  update users set name = update_data.name, age = (update_data.age)::int
  from (values ${sql(users)}) as update_data (id, name, age)
  where users.id = (update_data.id)::int
  returning users.id, users.name, users.age
`
```

### Dynamic values and `where in`
Value lists can also be created dynamically, making `where in` queries simple too.
```js
const users = await sql`
  select
    *
  from users
  where age in ${ sql([68, 75, 23]) }
`
```

or
```js
const [{ a, b, c }] = await sql`
  select
    *
  from (values ${ sql(['a', 'b', 'c']) }) as x(a, b, c)
`
```

### Named arguments in function calls
An object in the parentheses of a function call becomes its named arguments.
```js
await sql`
  select make_interval(${ sql({ days: 1, hours: 2 }) })
`

// Which results in:
select make_interval("days" => $1,"hours" => $2)
```

## Building queries

Postgres.js features a simple dynamic query builder by conditionally appending/omitting query fragments.
It works by nesting ` sql`` ` fragments within other ` sql`` ` calls or fragments. This allows you to build dynamic queries safely without risking sql injections through usual string concatenation.

### Partial queries
```js
const olderThan = x => sql`and age > ${ x }`

const filterAge = true

await sql`
  select
   *
  from users
  where name is not null ${
    filterAge
      ? olderThan(50)
      : sql``
  }
`
// Which results in:
select * from users where name is not null
// Or
select * from users where name is not null and age > 50
```

### Dynamic filters
```js
await sql`
  select
    *
  from users ${
    id
      ? sql`where user_id = ${ id }`
      : sql``
  }
`

// Which results in:
select * from users
// Or
select * from users where user_id = $1
```

Identifiers and values combine with operators, such as for a field of a `json` column:

```js
const column = email ? 'notifications' : 'settings'

await sql`
  select * from users where ${ sql(column) }->>'email' = ${ 'true' }
`

// Which results in:
select * from users where "notifications"->>'email' = $1
```

### Joining fragments

A fragment used as a separator joins a list of fragments and values. Values become parameters, and `false`, `null` and `undefined` are left out, so conditions can be written inline. A space is added on each side of the separator, and around the result, where there isn't one already.

```js
const where = sql`and`.join([
  sql`age > ${ age }`,
  name && sql`name = ${ name }`
])

await sql`
  select * from users ${ where.length ? sql`where ${ where }` : sql`` }
`

// Which results in:
select * from users where age > $1 and name = $2
```

### Dynamic ordering

```js
const id = 1
const order = {
  username: 'asc',
  created_at: 'desc'
}
await sql`
  select
    *
  from ticket
  where account = ${ id }
  order by ${
    Object.entries(order).flatMap(([column, order], i) =>
      [i ? sql`,` : sql``, sql`${ sql(column) } ${ order === 'desc' ? sql`desc` : sql`asc` }`]
    )
  }
`
```

### SQL functions
Using keywords or calling functions dynamically is also possible by using ``` sql`` ``` fragments.
```js
const date = null

await sql`
  update users set updated_at = ${ date || sql`now()` }
`

// Which results in:
update users set updated_at = now()
```

### Table names
Dynamic identifiers like table names and column names is also supported like so:
```js
const table = 'users'
    , column = 'id'

await sql`
  select ${ sql(column) } from ${ sql(table) }
`

// Which results in:
select "id" from "users"
```

### Quick primer on interpolation

Here's a quick oversight over all the ways to do interpolation in a query template string:

| Interpolation syntax       | Usage                         | Example                                                   |
| -------------              | -------------                 | -------------                                             |
| `${ sql`` }`               | for keywords or sql fragments | ``await sql`SELECT * FROM users ${sql`order by age desc` }` ``  |
| `${ sql(string) }`         | for identifiers               | ``await sql`SELECT * FROM ${sql('table_name')` ``               |
| `${ sql([] or {}, ...) }`  | for helpers                   | ``await sql`INSERT INTO users ${sql({ name: 'Peter'})}` ``      |
| `${ 'somevalue' }`         | for values                    | ``await sql`SELECT * FROM users WHERE age = ${42}` ``           |

## Advanced query methods

### Cursors

#### ```await sql``.cursor([rows = 1], [fn])```

Use cursors if you need to throttle the amount of rows being returned from a query. You can use a cursor either as an [async iterable](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of) or with a callback function. For a callback function new results won't be requested until the promise / async callback function has resolved.

Inside `sql.begin` or on a reserved connection every cursor has a portal of its own, so several can be open at once and other queries can run between their batches.

##### callback function
```js
await sql`
  select
    *
  from generate_series(1,4) as x
`.cursor(async([row]) => {
  // row = { x: 1 }
  await http.request('https://example.com/wat', { row })
})
```

##### for await...of
```js
// for await...of
const cursor = sql`select * from generate_series(1,4) as x`.cursor()

for await (const [row] of cursor) {
  // row = { x: 1 }
  await http.request('https://example.com/wat', { row })
}
```

A single row will be returned by default, but you can also request batches by setting the number of rows desired in each batch as the first argument to `.cursor`:
```js
await sql`
  select
    *
  from generate_series(1,1000) as x
`.cursor(10, async rows => {
  // rows = [{ x: 1 }, { x: 2 }, ... ]
  await Promise.all(rows.map(row =>
    http.request('https://example.com/wat', { row })
  ))
})
```

If an error is thrown inside the callback function no more rows will be requested and the outer promise will reject with the thrown error.

You can close the cursor early either by calling `break` in the `for await...of` loop, or by returning the token `sql.CLOSE` from the callback function.

```js
await sql`
  select * from generate_series(1,1000) as x
`.cursor(row => {
  return Math.random() > 0.9 && sql.CLOSE // or sql.END
})
```

### Instant iteration

#### ```await sql``.forEach(fn)```

If you want to handle rows returned by a query one by one, you can use `.forEach` which returns a promise that resolves once there are no more rows.
```js
await sql`
  select created_at, name from events
`.forEach(row => {
  // row = { created_at: '2019-11-22T14:22:00Z', name: 'connected' }
})

// No more rows
```

### Query Descriptions
#### ```await sql``.describe() -> Result[]```

Rather than executing a given query, `.describe` will return information utilized in the query process. This information can include the query identifier, column types, etc.

This is useful for debugging and analyzing your Postgres queries. Furthermore, **`.describe` will give you access to the final generated query string that would be executed.**

### Rows as Array of Values
#### ```sql``.values()```

Using `.values` will return rows as an array of values for each column, instead of objects.

This can be useful to receive identically named columns, or for specific performance/transformation reasons. The column definitions are still included on the result array, plus access to parsers for each column.

### Rows as Raw Array of Buffers
#### ```sql``.raw()```

Using `.raw` will return rows as an array with `Buffer` values for each column, instead of objects.

This can be useful for specific performance/transformation reasons. The column definitions are still included on the result array, plus access to parsers for each column.

### Queries in Files
#### `await sql.file(path, [args], [options]) -> Result[]`

Using a file for a query is also supported with optional parameters to use if the file includes `$1, $2, etc`

```js
const result = await sql.file('query.sql', ['Murray', 68])
```

### Multiple statements in one query
#### ```await sql``.simple()```

The postgres wire protocol supports ["simple"](https://www.postgresql.org/docs/current/protocol-flow.html#id-1.10.6.7.4) and ["extended"](https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-FLOW-EXT-QUERY) queries. "simple" queries supports multiple statements, but does not support any dynamic parameters. "extended" queries support parameters but only one statement. To use "simple" queries you can use
```sql``.simple()```. That will create it as a simple query.

```js
await sql`select 1; select 2;`.simple()
```

### Copy to/from as Streams

Postgres.js supports [`COPY ...`](https://www.postgresql.org/docs/14/sql-copy.html) queries, which are exposed as [Node.js streams](https://nodejs.org/api/stream.html).

#### ```await sql`copy ... from stdin`.writable() -> Writable```

```js
import { pipeline } from 'node:stream/promises'

// Stream of users with the default tab delimitated cells and new-line delimitated rows
const userStream = Readable.from([
  'Murray\t68\n',
  'Walter\t80\n'
])

const query = await sql`copy users (name, age) from stdin`.writable()
await pipeline(userStream, query);
query.count // 2, the number of rows copied, once the stream has finished
```

#### ```await sql`copy ... to stdout`.readable() -> Readable```

##### Using Stream Pipeline
```js
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'

const readableStream = await sql`copy users (name, age) to stdout`.readable()
await pipeline(readableStream, createWriteStream('output.tsv'))
// output.tsv content: `Murray\t68\nWalter\t80\n`
```

##### Using `for await...of`
```js
const readableStream = await sql`
  copy (
    select name, age
    from users
    where age = 68
  ) to stdout
`.readable()
for await (const chunk of readableStream) {
  // chunk.toString() === `Murray\t68\n`
}
```

> **NOTE** This is a low-level API which does not provide any type safety. To make this work, you must match your [`copy query` parameters](https://www.postgresql.org/docs/14/sql-copy.html) correctly to your [Node.js stream read or write](https://nodejs.org/api/stream.html) code. Ensure [Node.js stream backpressure](https://nodejs.org/en/learn/modules/backpressuring-in-streams) is handled correctly to avoid memory exhaustion.

### Canceling Queries in Progress

Postgres.js supports, [canceling queries in progress](https://www.postgresql.org/docs/7.1/protocol-protocol.html#AEN39000). It works by opening a new connection with a protocol level startup message to cancel the current query running on a specific connection. That means there is no guarantee that the query will be canceled, and due to the possible race conditions it might even result in canceling another query. This is fine for long running queries, but in the case of high load and fast queries it might be better to simply ignore results instead of canceling.

```js
const query = sql`select pg_sleep 100`.execute()
setTimeout(() => query.cancel(), 100)
const result = await query
```

`.signal()` cancels the query when an [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal) aborts: one still waiting for a connection is rejected without being sent, and a running one gets a cancel request. A cursor canceled while its callback runs, or while an async iterator over it is between batches, is stopped by the client instead: it fetches no more rows, closes its portal and rejects with `57014`, with no cancel request sent.

```js
await sql`select * from report()`.signal(AbortSignal.timeout(5000))
```

A query waits for a connection when every connection is reserved, in a transaction or has `max_pipeline` queries in flight. `queue_timeout` (in seconds) rejects it with `QUEUE_TIMEOUT` if it waits longer, without ever sending it, and the same goes for `sql.begin` and `sql.reserve`. Once a query is sent, PostgreSQL's own `statement_timeout` is the limit.

If the server stops answering while its connection stays up, as when it stalls or something in between keeps the connection and drops the traffic, the query waits forever: keep-alive probes are still answered, and the `statement_timeout` error never arrives. `answer_timeout` (in seconds) closes a connection that has waited that long for an answer without receiving anything, and rejects its queries with `ANSWER_TIMEOUT`. Every message received starts the wait again, so a query that keeps sending rows or notices runs as long as it takes, but one that runs longer than that without sending anything is cut off too; set it above `statement_timeout`. A reserved connection is not timed, nor is a connection while the server is waiting on the client: during a cursor's callback, a `copy ... from stdin` being written, or a stream whose reader has paused it.

### Execute

#### ```await sql``.execute()```

The lazy Promise implementation in Postgres.js is what allows it to distinguish [Nested Fragments](#building-queries) from the main outer query. This also means that queries are always executed at the earliest in the following tick. If you have a specific need to execute the query in the same tick, you can call `.execute()`

### Inspecting a query

`query.text` is the text sent to the server, with `$1`, `$2` for the parameters, and `query.parameters` their values. Both work before the query is sent, without a connection:

```js
const query = sql`select * from users where id = ${ 1 } and name = ${ 'Murray' }`
query.text       // 'select * from users where id = $1 and name = $2'
query.parameters // [1, 'Murray']
```

### Unsafe raw string queries

<details>
<summary>Advanced unsafe use cases</summary>

### `await sql.unsafe(query, [args], [options]) -> Result[]`

If you know what you're doing, you can use `unsafe` to pass any string you'd like to postgres. Please note that this can lead to SQL injection if you're not careful.

```js
sql.unsafe('select ' + danger + ' from users where id = ' + dragons)
```

Values go in `args` and are referred to as `$1`, `$2` and so on, so they are never part of the string itself:

```js
sql.unsafe('select * from users where id = $1 and age > $2', [id, age])
```

`options` takes:

| Option | Default | |
| --- | --- | --- |
| `prepare` | `false` | Prepare the query as a named statement. Off by default because a string built at run time may be different every time, and each would stay prepared on the server. |
| `simple` | `true` without `args` | Send it with the simple protocol, which allows several statements in one string but no `args`. |

You can also nest `sql.unsafe` within a safe `sql` expression.  This is useful if only part of your fraction has unsafe elements.

```js
const triggerName = 'friend_created'
const triggerFnName = 'on_friend_created'
const eventType = 'insert'
const schema_name = 'app'
const table_name = 'friends'

await sql`
  create or replace trigger ${sql(triggerName)}
  after ${sql.unsafe(eventType)} on ${sql.unsafe(`${schema_name}.${table_name}`)}
  for each row
  execute function ${sql(triggerFnName)}()
`

await sql`
  create role friend_service with login password ${sql.unsafe(`'${password}'`)}
`
```

</details>

## Transactions

#### BEGIN / COMMIT `await sql.begin([options = ''], fn) -> fn()`

Use `sql.begin` to start a new transaction. Postgres.js will reserve a connection for the transaction and supply a scoped `sql` instance for all transaction uses in the callback function. `sql.begin` will resolve with the returned value from the callback function.

`BEGIN` is automatically sent with the optional options, and if anything fails `ROLLBACK` will be called so the connection can be released and execution can continue.

A query that fails in a transaction aborts it, whether the server rejected it or Postgres.js could not build it (an `undefined` value, say), as PostgreSQL does: catching the error does not let the rest commit, and a later `COMMIT` answers `ROLLBACK`. The transaction commits only once its cursors have finished, also those the callback did not await.

```js
const [user, account] = await sql.begin(async sql => {
  const [user] = await sql`
    insert into users (
      name
    ) values (
      'Murray'
    )
    returning *
  `

  const [account] = await sql`
    insert into accounts (
      user_id
    ) values (
      ${ user.user_id }
    )
    returning *
  `

  return [user, account]
})
```

Do note that you can often achieve the same result using [`WITH` queries (Common Table Expressions)](https://www.postgresql.org/docs/current/queries-with.html) instead of using transactions.

It's also possible to pipeline the requests in a transaction if needed by returning an array with queries from the callback function like this:

```js
const result = await sql.begin(sql => [
  sql`update ...`,
  sql`update ...`,
  sql`insert ...`
])
```

Queries that are not awaited one by one are pipelined anywhere in the transaction, so `Promise.all` pipelines a group of them between other queries. They run in the order they were made, so a later query sees what an earlier one in the group did:

```js
await sql.begin(async sql => {
  const [movie] = await sql`select * from movie where name = 'Star Wars'`

  await Promise.all([
    sql`insert into movie_actor ...${ movie.id }`,
    sql`insert into movie_release ...${ movie.id }`
  ])

  await sql`select ...`
})
```

#### SAVEPOINT `await sql.savepoint([name], fn) -> fn()`

```js
sql.begin('read write', async sql => {
  const [user] = await sql`
    insert into users (
      name
    ) values (
      'Murray'
    )
  `

  const [account] = (await sql.savepoint(sql =>
    sql`
      insert into accounts (
        user_id
      ) values (
        ${ user.user_id }
      )
    `
  ).catch(err => {
    // Account could not be created. ROLLBACK SAVEPOINT is called because we caught the rejection.
  })) || []

  return [user, account]
})
.then(([user, account]) => {
  // great success - COMMIT succeeded
})
.catch(() => {
  // not so good - ROLLBACK was called
})
```


#### Nested `sql.begin`

Inside a transaction, `sql.begin(fn)` runs `fn` in a savepoint, so code that opens a transaction works the same whether it is given the pool or a transaction. Nothing it does is committed until the outer transaction commits. A mode other than the transaction's own, such as `'read only'` inside a `'read write'` transaction, throws `NESTED_TRANSACTION_MODE`, since a savepoint can't change it, and so does `sql.prepare()` inside a nested `begin`. A savepoint with a name is still `sql.savepoint(name, fn)`.

```js
async function transfer(sql, from, to, amount) {
  return sql.begin(async sql => {
    await sql`update accounts set balance = balance - ${ amount } where id = ${ from }`
    await sql`update accounts set balance = balance + ${ amount } where id = ${ to }`
  })
}

await transfer(sql, 1, 2, 10)                 // its own transaction
await sql.begin(sql => transfer(sql, 1, 2, 10)) // a savepoint in this one
```

#### ROLLBACK `await sql.rollback()`

Rolls back the transaction without throwing, and `sql.begin` resolves with what the callback returns (#500). Called in a savepoint or a nested `sql.begin`, it rolls back only that savepoint, and the outer transaction goes on. The rollback is sent at once, after any queries already made. Queries made after it in the same scope are not sent and reject with `TRANSACTION_ROLLED_BACK`, and so does the `sql.begin` they were made in.

```js
const result = await sql.begin(async sql => {
  const [order] = await sql`insert into orders ${ sql(input) } returning *`
  if (!await inStock(sql, order))
    return (await sql.rollback(), { saved: false })
  return { saved: true, order }
})
```

#### PREPARE TRANSACTION `await sql.prepare([name]) -> fn()`

Indicates that the transactions should be prepared using the [`PREPARE TRANSACTION [NAME]`](https://www.postgresql.org/docs/current/sql-prepare-transaction.html) statement
instead of being committed.

```js
sql.begin('read write', async sql => {
  const [user] = await sql`
    insert into users (
      name
    ) values (
      'Murray'
    )
  `

  await sql.prepare('tx1')
})
```

## Data Transformation

Postgres.js allows for transformation of the data passed to or returned from a query by using the `transform` option.

Built in transformation functions are:

* For camelCase - `postgres.camel`, `postgres.toCamel`, `postgres.fromCamel`
* For PascalCase - `postgres.pascal`, `postgres.toPascal`, `postgres.fromPascal`
* For Kebab-Case - `postgres.kebab`, `postgres.toKebab`, `postgres.fromKebab`

These built in transformations will only convert to/from snake_case. For example, using `{ transform: postgres.toCamel }` will convert the column names to camelCase only if the column names are in snake_case to begin with. `{ transform: postgres.fromCamel }` will convert camelCase only to snake_case.

By default, using `postgres.camel`, `postgres.pascal` and `postgres.kebab` will perform a two-way transformation - both the data passed to the query and the data returned by the query will be transformed:

```js
// Transform the column names to and from camel case
const sql = postgres({ transform: postgres.camel })

await sql`CREATE TABLE IF NOT EXISTS camel_case (a_test INTEGER, b_test TEXT)`
await sql`INSERT INTO camel_case ${ sql([{ aTest: 1, bTest: 1 }]) }`
const data = await sql`SELECT ${ sql('aTest', 'bTest') } FROM camel_case`

console.log(data) // [ { aTest: 1, bTest: '1' } ]
```

To only perform half of the transformation (eg. only the transformation **to** or **from** camel case), use the other transformation functions:

```js
// Transform the column names only to camel case
// (for the results that are returned from the query)
postgres({ transform: postgres.toCamel })

await sql`CREATE TABLE IF NOT EXISTS camel_case (a_test INTEGER)`
await sql`INSERT INTO camel_case ${ sql([{ a_test: 1 }]) }`
const data = await sql`SELECT a_test FROM camel_case`

console.log(data) // [ { aTest: 1 } ]
```

```js
// Transform the column names only from camel case
// (for interpolated inserts, updates, and selects)
const sql = postgres({ transform: postgres.fromCamel })

await sql`CREATE TABLE IF NOT EXISTS camel_case (a_test INTEGER)`
await sql`INSERT INTO camel_case ${ sql([{ aTest: 1 }]) }`
const data = await sql`SELECT ${ sql('aTest') } FROM camel_case`

console.log(data) // [ { a_test: 1 } ]
```

> Note that Postgres.js does not rewrite the static parts of the tagged template strings. So to transform column names in your queries, the `sql()` helper must be used - eg. `${ sql('columnName') }` as in the examples above.

### Transform `undefined` Values

By default, Postgres.js will throw the error `UNDEFINED_VALUE: Undefined values are not allowed` when undefined values are passed

```js
// Transform the column names to and from camel case
const sql = postgres({
  transform: {
    undefined: null
  }
})

await sql`CREATE TABLE IF NOT EXISTS transform_undefined (a_test INTEGER)`
await sql`INSERT INTO transform_undefined ${ sql([{ a_test: undefined }]) }`
const data = await sql`SELECT a_test FROM transform_undefined`

console.log(data) // [ { a_test: null } ]
```

To combine with the built in transform functions, spread the transform in the `transform` object:

```js
// Transform the column names to and from camel case
const sql = postgres({
  transform: {
    ...postgres.camel,
    undefined: null
  }
})

await sql`CREATE TABLE IF NOT EXISTS transform_undefined (a_test INTEGER)`
await sql`INSERT INTO transform_undefined ${ sql([{ aTest: undefined }]) }`
const data = await sql`SELECT ${ sql('aTest') } FROM transform_undefined`

console.log(data) // [ { aTest: null } ]
```

### Custom Transform Functions

To specify your own transformation functions, you can use the `column`, `value` and `row` options inside of `transform`, each an object possibly including `to` and `from` keys:

* `to`: The function to transform the outgoing query column name to, i.e `SELECT ${ sql('aName') }` to `SELECT a_name` when using `postgres.toCamel`.
* `from`: The function to transform the incoming query result column name to, see example below.

> Both parameters are optional, if not provided, the default transformation function will be used.

```js
// Implement your own functions, look at postgres.toCamel, etc
// as a reference:
// toCamel and the others in types.js
function transformColumnToDatabase() { /* ... */ }
function transformColumnFromDatabase() { /* ... */ }

const sql = postgres({
  transform: {
    column: {
      to: transformColumnToDatabase,
      from: transformColumnFromDatabase,
    },
    value: { /* ... */ },
    row: { /* ... */ }
  }
})
```

## Listen & notify

When you call `.listen`, a dedicated connection will be created to ensure that you receive notifications instantly. This connection will be used for any further calls to `.listen`. The connection will automatically reconnect according to a backoff reconnection pattern to not overload the database server.

### Listen `await sql.listen(channel, onnotify, [onlisten]) -> { state }`
`.listen` takes the channel name, a function to handle each notify, and an optional function to run every time listen is registered and ready (happens on initial connect and reconnects). It returns a promise which resolves once the `LISTEN` query to Postgres completes, or if there is already a listener active.

```js
await sql.listen('news', payload => {
  const json = JSON.parse(payload)
  console.log(json.this) // logs 'is'
})
```

The optional `onlisten` method is great to use for a very simply queue mechanism:

```js
await sql.listen(
  'jobs',
  (x) => run(JSON.parse(x)),
  ( ) => sql`select unfinished_jobs()`.forEach(run)
)

function run(job) {
  // And here you do the work you please
}
```
### Notify `await sql.notify(channel, payload) -> Result[]`
Notify can be done as usual in SQL, or by using the `sql.notify` method.
```js
sql.notify('news', JSON.stringify({ no: 'this', is: 'news' }))
```

## Realtime subscribe

Postgres.js implements the logical replication protocol of PostgreSQL to support subscription to real-time updates of `insert`, `update`, `delete` and `truncate` operations.

> **NOTE** To make this work you must [create the proper publications in your database](https://www.postgresql.org/docs/current/sql-createpublication.html), enable logical replication by setting `wal_level = logical` in `postgresql.conf` and connect using either a replication or superuser.

### Quick start

#### Create a publication (eg. in migration)
```sql
CREATE PUBLICATION alltables FOR ALL TABLES
```

#### Subscribe to updates
```js
const sql = postgres({ publications: 'alltables' })

const { unsubscribe } = await sql.subscribe(
  'insert:events',
  (row, { command, relation, key, old, lsn, time, xid }) => {
    // Callback function for each row change
    // tell about new event row over eg. websockets or do something else
  },
  () => {
    // Callback on initial connect and potential reconnects
  },
  error => {
    // A handler failed, or the stream had an error
  }
)
```

Besides the row, each change comes with the transaction it was part of: its `lsn` (like `'0/1A2B3C4'`), its commit `time` and its `xid`. An `update` also has `old` when the table's replica identity sends it, and a `truncate` has no row but `cascade` and `restartIdentity`.

### Handlers that return promises

A handler may be async. Changes are then handled one after the other, in the order they were committed, and the stream waits while a handler is busy instead of piling changes up in memory:

```js
await sql.subscribe('insert:orders', async row => {
  await queue.publish('order', row)
})
```

### Persistent slots

By default a subscription uses a temporary replication slot, which the server drops when the connection closes, so changes made while the subscriber is away are not seen.

Give the slot a name to keep it. It is created if it does not exist, and streaming starts where it was last confirmed, so nothing committed while the subscriber was down is missed:

```js
const sql = postgres({ publications: 'alltables', slot: 'orders_worker' })

await sql.subscribe('*:orders', async(row, info) => {
  await handle(row, info)
})
```

With a slot, a transaction is confirmed to the server only after every handler for it has finished. If a handler throws or rejects, the transaction is not confirmed: `onerror` is called, the stream restarts and the transaction is delivered again. Delivery is at least once, so a handler should cope with seeing a transaction twice, for instance by remembering the `lsn` it handled last.

While nothing is in flight, the slot is also confirmed as far as the server has got, so a quiet slot does not keep the server holding WAL.

A persistent slot keeps WAL on the server until it is confirmed, so drop it when it is no longer used:

```sql
select pg_drop_replication_slot('orders_worker')
```

### Subscribe pattern

You can subscribe to specific operations, tables, or even rows with primary keys.

#### `operation`      `:` `schema` `.` `table` `=` `primary_key`

**`operation`** is one of ``` * | insert | update | delete | truncate ``` and defaults to `*`

**`schema`** defaults to `public`

**`table`** is a specific table name and defaults to `*`

**`primary_key`** can be used to only subscribe to specific rows

### Examples

```js
sql.subscribe('*',                () => /* everything */ )
sql.subscribe('insert',           () => /* all inserts */ )
sql.subscribe('*:users',          () => /* all operations on the public.users table */ )
sql.subscribe('delete:users',     () => /* all deletes on the public.users table */ )
sql.subscribe('update:users=1',   () => /* all updates on the users row with a primary key = 1 */ )
sql.subscribe('truncate:users',   () => /* the public.users table was truncated */ )
```

## Numbers, bigint, numeric

`Number` in javascript is only able to represent 2<sup>53</sup>-1 safely which means that types in PostgreSQLs like `bigint` and `numeric` won't fit into `Number`.

Since Node.js v10.4 we can use [`BigInt`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt) to match the PostgreSQL type `bigint` which is returned for eg. `count(*)`. Unfortunately, it doesn't work with `JSON.stringify` out of the box, so Postgres.js will return it as a string.

If you want to use `BigInt` you can add this custom type:

```js
const sql = postgres({
  types: {
    bigint: postgres.BigInt
  }
})
```

There is currently no guaranteed way to handle `numeric` / `decimal` types in native Javascript. **These [and similar] types will be returned as a `string`**. The best way in this case is to use  [custom types](#custom-types).

## Result Array

The `Result` Array returned from queries is a custom array allowing for easy destructuring or passing on directly to JSON.stringify or general Array usage. It includes the following properties.

### .count

The `count` property is the number of affected rows returned by the database. This is useful for insert, update and delete operations to know the number of rows since .length will be 0 in these cases if not using `RETURNING ...`.

### .command

The `command` run by the query - eg. one of `SELECT`, `UPDATE`, `INSERT`, `DELETE`

### .columns

The `columns` returned by the query useful to determine types, or map to the result values when using `.values()`

```js
{
  name  : String,    // Column name,
  type  : oid,       // PostgreSQL oid column type
  parser: Function   // The function used by Postgres.js for parsing
}
```

### .statement

The `statement` contains information about the statement implicitly created by Postgres.js.

```js
{
  name    : String,  // The auto generated statement name
  string  : String,  // The actual query string executed
  types   : [oid],   // An array of oid expected as input parameters
  columns : [Column] // Array of columns - same as Result.columns
}
```

### .state

This is the state `{ pid, secret }` of the connection that executed the query.

## Connection details

### All Postgres options

```js
const sql = postgres('postgres://username:password@host:port/database', {
  host                 : '',            // Postgres ip address[es] or domain name[s]
  port                 : 5432,          // Postgres server port[s]
  path                 : '',            // unix socket path (usually '/tmp')
  database             : '',            // Name of database to connect to
  username             : '',            // Username of database user, or a function returning it
  password             : '',            // Password of database user, or a function returning it
  ssl                  : false,         // true, prefer, require, verify-full, tls.connect options
  sslnegotiation       : null,          // 'direct' for TLS from the first byte (PostgreSQL 17+)
  channel_binding      : 'prefer',      // SCRAM-SHA-256-PLUS over TLS: 'disable', 'prefer' or 'require'
  max                  : 10,            // Max number of connections
  min                  : 0,             // Connections kept open once the pool is used
  max_pipeline         : 100,           // Max number of queries pipelined on one connection
  scheduler            : true,          // Pipeline where a query should be done soonest (more info below)
  max_lifetime         : null,          // Max lifetime in seconds (more info below)
  idle_timeout         : 0,             // Idle connection timeout in seconds
  connect_timeout      : 30,            // Connect timeout in seconds
  answer_timeout       : null,          // Seconds the server may send nothing while a query waits, null for no limit
  queue_timeout        : 0,             // Seconds a query may wait for a connection, 0 for no limit
  keep_alive           : 60,            // TCP keep-alive in seconds, 0 or null for none
  backoff              : fn,            // Seconds to wait before reconnecting, given the attempt
  prepare              : true,          // Automatic creation of prepared statements
  infer                : false,         // true types parameters from JS values, as v3 did
  types                : [],            // Array of custom types, see more below
  onnotice             : fn,            // Default console.log, set false to silence NOTICE
  onnotify             : fn,            // (channel, payload, pid) for every notification
  onparameter          : fn,            // (key, value) when server param change
  onclose              : fn,            // (connection id) when a connection closes
  debug                : false,         // true, or a function called with (connection, query, params, types)
  socket               : fn,            // (options, host, port) returning a custom socket to use
  transform            : {
    undefined          : undefined,     // Transforms undefined values (eg. to null)
    column             : fn,            // Transforms incoming column names
    value              : fn,            // Transforms incoming row values
    row                : fn             // Transforms entire rows
  },
  connection           : {
    application_name   : 'postgres.js', // Default application_name
    ...                                 // Other connection parameters, see https://www.postgresql.org/docs/current/runtime-config-client.html
  },
  target_session_attrs : null,          // Use 'read-write' with multiple hosts to
                                        // ensure only connecting to primary
  fetch_types          : true,          // Fetches array types and other types it does not know
  publications         : 'alltables',   // Publications for sql.subscribe
  slot                 : null,          // A permanent replication slot for sql.subscribe
  onread               : true,          // Read into one shared buffer per connection (Node.js, Bun, Deno)
  unref_sockets        : false          // Idle connections don't keep the process alive
})
```

Note that `max_lifetime = 60 * (30 + Math.random() * 30)` by default. This resolves to an interval between 30 and 60 minutes to optimize for the benefits of prepared statements **and** working nicely with Linux's OOM killer.

### Dynamic passwords

When clients need to use alternative authentication schemes such as access tokens or connections to databases with rotating passwords, provide either a synchronous or asynchronous function that will resolve the dynamic password value at connection time.

```js
const sql = postgres(url, {
  // Other connection config
  ...
  // Password function for the database user
  password : async () => await signer.getAuthToken(),
})
```

The user can be a function as well, for credentials that rotate both, such as those from a secrets manager. It is called each time a connection opens, before the password. Give `database` too, since it can no longer default to the user name.

```js
const sql = postgres({
  database: 'app',
  username: async () => (await secrets.get()).username,
  password: async () => (await secrets.get()).password
})
```

### Password file

With no password given, Postgres.js reads one from the file in `PGPASSFILE`, or `~/.pgpass` (`%APPDATA%\postgresql\pgpass.conf` on Windows), as libpq does: lines of `host:port:database:user:password`, where `*` matches anything and `\` escapes a `:` or `\`. On Unix the file is ignored unless only its owner can read it (`chmod 600`).

### SSL

Although [vulnerable to MITM attacks](https://security.stackexchange.com/a/229297/174913), a common configuration for the `ssl` option for some cloud providers is to set `rejectUnauthorized` to `false` (if `NODE_ENV` is `production`):

```js
const sql =
  process.env.NODE_ENV === 'production'
    ? // "Unless you're using a Private or Shield Heroku Postgres database, Heroku Postgres does not currently support verifiable certificates"
      // https://help.heroku.com/3DELT3RK/why-can-t-my-third-party-utility-connect-to-heroku-postgres-with-ssl
      postgres({ ssl: { rejectUnauthorized: false } })
    : postgres()
```

For more information regarding `ssl` with `postgres`, check out the [Node.js documentation for tls](https://nodejs.org/api/tls.html#tlsconnectoptions-callback).

On Node.js an `ssl` object with a `ca` is made into one TLS context, which every connection made with that object shares, so a long `ca` list is parsed once rather than for each connection. Replacing one of its values, as with a renewed `cert`, makes a new context for the connections opened after that, but a change inside a value, such as a push onto the same `ca` array, is not seen. A `secureContext` given in the object is used as it is.

The modes follow libpq's `sslmode`: `require`, `prefer` and `allow` encrypt without checking the certificate, and `verify-full` (or `sslrootcert=system` in the url) checks it against the system's certificate authorities. `prefer` and `allow` fall back to an unencrypted connection when the server has no TLS. Cloudflare Workers always check the certificate.

#### Direct TLS

PostgreSQL 17 and later can start TLS on the first byte instead of being asked first, which saves a round trip when connecting:

```js
const sql = postgres('postgres://host/db?sslmode=require&sslnegotiation=direct')
// or
const sql = postgres({ ssl: 'require', sslnegotiation: 'direct' })
```

On Node.js this is also the fastest encrypted connection, as it reads into the same shared buffer as a plain one. It needs a server that supports it, and is not available in Cloudflare Workers, whose sockets cannot send the ALPN it requires.

#### Channel binding

Over TLS, SCRAM authentication is bound to the server's certificate with SCRAM-SHA-256-PLUS (`tls-server-end-point`) when the server offers it, so a man in the middle holding some other certificate that looks valid can't relay the login. `channel_binding` works as in libpq, and can also be given in the url or as `PGCHANNELBINDING`:

- `'prefer'` (the default) binds when the server offers it, and authenticates as before when it doesn't.
- `'require'` refuses any connection that isn't bound, so a server that isn't reached over TLS, doesn't offer it or authenticates without SCRAM is rejected with `CHANNEL_BINDING_REQUIRED`.
- `'disable'` never binds.

```js
const sql = postgres('postgres://host/db?sslmode=verify-full&channel_binding=require')
```

Certificates signed with Ed25519, for which binding isn't defined, are not bound. Cloudflare Workers sockets don't expose the server certificate, so there `'prefer'` doesn't bind and `'require'` is rejected.


### Multi-host connections - High Availability (HA)

Multiple connection strings can be passed to `postgres()` in the form of `postgres('postgres://localhost:5432,localhost:5433', ...)`. This works the same as native the `psql` command. Read more at [multiple host URIs](https://www.postgresql.org/docs/13/libpq-connect.html#LIBPQ-MULTIPLE-HOSTS).

Connections will be attempted in order of the specified hosts/ports. On a successful connection, all retries will be reset. This ensures that hosts can come up and down seamlessly.

If you specify `target_session_attrs: 'primary'` or `PGTARGETSESSIONATTRS=primary` Postgres.js will only connect to the primary host, allowing for zero downtime failovers.

### The Connection Pool

Connections are created lazily once a query is created. This means that simply doing const `sql = postgres(...)` won't have any effect other than instantiating a new `sql` instance.

> No connection will be made until a query is made.

For example:

```js
const sql = postgres() // no connections are opened

await sql`...` // one connection is now opened
await sql`...` // previous opened connection is reused

// two connections are opened now
await Promise.all([
  sql`...`,
  sql`...`
])
```

> When there are high amount of concurrent queries, `postgres` will open as many connections as needed up until `max` number of connections is reached. By default `max` is 10. This can be changed by setting `max` in the `postgres()` call. Example - `postgres('connectionURL', { max: 20 })`.

This means that we get a much simpler story for error handling and reconnections. Queries will be sent over the wire immediately on the next available connection in the pool. Connections are automatically taken out of the pool if you start a transaction using `sql.begin()`, and automatically returned to the pool once your transaction is done.

Any query which was already sent over the wire will be rejected if the connection is lost. It'll automatically defer to the error handling you have for that query, and since connections are lazy it'll automatically try to reconnect the next time a query is made. The benefit of this is no weird generic "onerror" handler that tries to get things back to normal, and also simpler application code since you don't have to handle errors out of context.

There are no guarantees about queries executing in order unless using a transaction with `sql.begin()` or setting `max: 1`. Of course doing a series of queries, one awaiting the other will work as expected, but that's just due to the nature of js async/promise handling, so it's not necessary for this library to be concerned with ordering.

Since this library automatically creates prepared statements, it also has a default max lifetime for connections to prevent memory bloat on the database itself. This is a random interval for each connection between 30 and 60 minutes. This allows multiple connections to independently come up and down without affecting the service.

What a statement takes and returns is learned once for the whole pool, not once per connection, so a new connection never has to ask about a query the pool already knows. Each connection still prepares a statement itself the first time it runs it.

Up to `max_pipeline` queries (100 by default) are sent on one connection before the answers come back, which is what makes many small queries fast. A query that waits on a lock holds up those behind it on the same connection; lower `max_pipeline` if that matters more to you than throughput.

#### Scheduling

A query goes to an idle connection when there is one. When every connection is busy, the pool pipelines it on the connection where it should be done soonest, from how long each statement has taken before and how long what is in flight has been running, so a quick query doesn't wait behind a slow one when another connection is about to be free. Slow queries (around 100 ms or more) are kept together on the connections that already run slow work, within twice their own time, once the rest of the pool is needed for quick work; how many connections that is follows how much quick and slow work has come in over the last few seconds. Nothing has to be configured, and while nothing slow is in flight the pool places queries as before. `scheduler: false` turns it off: a busy pool then pipelines on the connection with the fewest queries in flight. With `max: 1` there is only one connection to choose, so the scheduler is off.

#### Pool stats

`sql.stats` tells what the pool is doing right now:

```js
sql.stats
// { connections: 3, opening: 0, idle: 1, leased: 1, waiting: 0 }
```

### Connection timeout

By default, connections will not close until `.end()` is called. However, it may be useful to have them close automatically when:

- re-instantiating multiple ` sql`` ` instances
- using Postgres.js in a Serverless environment (Lambda, etc.)
- using Postgres.js with a database service that automatically closes connections after some time (see [`ECONNRESET` issue](https://github.com/porsager/postgres/issues/179))

This can be done using the `idle_timeout` or `max_lifetime` options. These configuration options specify the number of seconds to wait before automatically closing an idle connection and the maximum time a connection can exist, respectively.

For example, to close a connection that has either been idle for 20 seconds or existed for more than 30 minutes:

```js
const sql = postgres({
  idle_timeout: 20,
  max_lifetime: 60 * 30
})
```

### Cloudflare Workers support

Postgres.js runs in Cloudflare Workers on the [TCP socket API](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/). Bundlers pick the Workers build through the `workerd` export condition, so the import is the same as anywhere else.

You can use Postgres.js directly in a Worker, or to benefit from connection pooling and query caching, via the [Hyperdrive](https://developers.cloudflare.com/hyperdrive/learning/connect-to-postgres/#driver-examples) service available to Workers by passing the Hyperdrive `connectionString` when creating a new `postgres` client as follows:

```ts
import postgres from 'postgres'

interface Env {
  HYPERDRIVE: Hyperdrive
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const sql = postgres(env.HYPERDRIVE.connectionString)
    const results = await sql`SELECT * FROM users LIMIT 10`
    ctx.waitUntil(sql.end())
    return Response.json(results)
  }
}
```

Postgres.js uses `Buffer`, `crypto` and `events` from the Node.js compatibility of Workers, which is on by default from the compatibility date 2026-08-04. For an earlier date, enable it in `wrangler.toml`:

```toml
compatibility_flags = ["nodejs_compat"]
```

A few things differ in Workers:

- The server certificate is always checked, whatever `ssl` is set to.
- `sslnegotiation: 'direct'` is refused with `SSL_NEGOTIATION_NOT_SUPPORTED`, as Workers sockets cannot send ALPN.
- Channel binding isn't available, as Workers sockets don't expose the server certificate, so `channel_binding: 'require'` is rejected with `CHANNEL_BINDING_REQUIRED`.
- A connection belongs to the request that opened it, so a client made outside `fetch` cannot be shared between requests.

### Auto fetching of array types

The built-in types and their arrays are known without asking the server. Before its first query a pool asks once for the array types and domains that the database has besides those, so an array of an enum or a domain over a built-in type is read and written like its base type. A type made after that, and any type that is neither, is read and written as text, as in v3.

If you have revoked access to `pg_catalog` this feature will no longer work and will need to be disabled.

You can disable this feature by setting `fetch_types` to `false`.

### Environmental variables

It is also possible to connect to the database without a connection string or any options. Postgres.js will fall back to the common environment variables used by `psql` as in the table below:

```js
const sql = postgres()
```

| Option             | Environment Variables    |
| ------------------ | ------------------------ |
| `host`             | `PGHOST`                 |
| `port`             | `PGPORT`                 |
| `database`         | `PGDATABASE`             |
| `username`         | `PGUSERNAME` or `PGUSER` |
| `password`         | `PGPASSWORD`             |
| `application_name` | `PGAPPNAME`              |
| `idle_timeout`     | `PGIDLE_TIMEOUT`         |
| `connect_timeout`  | `PGCONNECT_TIMEOUT`      |

### Prepared statements

Prepared statements will automatically be created for any queries where it can be inferred that the query is static. This can be disabled by using the `prepare: false` option, which is what a pooler in transaction mode without support for prepared statements needs (see below). With `prepare: false` a query with parameters is described before it runs, as in v3, which costs a round trip, but always uses the types the server has now. A prepared statement keeps the parameter types it was prepared with, on the server and here, and each connection reads rows and writes values only by what its own server described. If a column changes type so that a query no longer fits them, the query fails before it runs; Postgres.js then runs the query once more with a fresh description and prepares the statement again with the new types, unless it was sent in a transaction or on a reserved connection, where the error is returned and the next query is prepared afresh. Once any connection sees a statement describe differently, the other connections prepare it again before they next use it. Where the server can still cast the old parameter type to the new one, such as `json` to `text`, on a connection that has not yet seen the change, there is no error to act on, and the value is stored as that cast gives it; use `prepare: false` if columns change type while the application runs.

### Connection poolers

Postgres.js is tested through PgBouncer in session mode and in transaction mode, with and without its support for prepared statements.

| Pooler mode | Options | What does not work |
| ----------- | ------- | ------------------ |
| Session | none | Nothing, apart from what the pooler itself refuses |
| Transaction, with [`max_prepared_statements`](https://www.pgbouncer.org/config.html#max_prepared_statements) (PgBouncer 1.21+) | none | `LISTEN`, and `DEALLOCATE` sent as SQL |
| Transaction, without | `prepare: false` | `LISTEN`, and named prepared statements |

In both transaction modes a session belongs to a client only for the length of a transaction, so anything that has to outlive one, like `SET`, `LISTEN` or a temporary table, only works inside `sql.begin` or not at all. Use a direct connection, or a pooler in session mode, for `sql.listen` and `sql.subscribe`.

With `max_prepared_statements`, PgBouncer keeps one prepared statement on each server connection for every query text and set of parameter types, shared by all its clients. After a column changes type, a connection may be handed the statement prepared before the change, which still describes the old parameter types; where the server can cast the old type to the new one, there is no error to act on. Use `prepare: false` through PgBouncer if columns change type while the application runs.

PgBouncer refuses startup parameters it does not know, so a `connection` option like `{ 'some.var': 1 }` needs [`ignore_startup_parameters`](https://www.pgbouncer.org/config.html#ignore_startup_parameters) or `SET` inside a transaction instead. The pid in `state` is the pooler's, not the server's, so `pg_terminate_backend(state.pid)` does not end the session.

## Custom Types

You can add ergonomic support for custom types, or simply use `sql.typed(value, type)` inline, where type is the PostgreSQL `oid` for the type and the correctly serialized string. _(`oid` values for types can be found in the `pg_catalog.pg_type` table.)_

Adding Query helpers is the cleanest approach which can be done like this:

```js
const sql = postgres({
  types: {
    rect: {
      // The pg_types oid to pass to the db along with the serialized value.
      to        : 1337,

      // An array of pg_types oids to handle when parsing values coming from the db.
      from      : [1337],

      //Function that transform values before sending them to the db.
      serialize : ({ x, y, width, height }) => [x, y, width, height],

      // Function that transforms values coming from the db.
      parse     : ([x, y, width, height]) => { x, y, width, height }
    }
  }
})

// Now you can use sql.typed.rect() as specified above
const [custom] = await sql`
  insert into rectangles (
    name,
    rect
  ) values (
    'wat',
    ${ sql.typed.rect({ x: 13, y: 37, width: 42, height: 80 }) }
  )
  returning *
`

// custom = { name: 'wat', rect: { x: 13, y: 37, width: 42, height: 80 } }

```

A type whose oid isn't fixed, such as one from an extension, can be given by name instead, with `schema.name` allowed. Names are looked up when the pool starts, along with the type's array type, and queries wait for that. A name that doesn't exist rejects queries with `TYPE_NOT_FOUND`, and the lookup is tried again a second later, so a type created afterwards is found. Types by name need `fetch_types`.

```js
const sql = postgres({
  types: {
    vector: {
      to        : 'vector',
      from      : ['vector'],
      serialize : x => '[' + x.join(',') + ']',
      parse     : x => JSON.parse(x)
    }
  }
})

await sql`insert into items ${ sql({ embedding: sql.typed.vector([1, 2, 3]) }) }`
```

### Custom socket

Easily do in-process ssh tunneling to your database by providing a custom socket for Postgres.js to use. The function (optionally async) is called with the options and the host and port to connect to, and must return a socket-like duplex stream. If the socket has done TLS itself, set `negotiated: true` on it so Postgres.js does not ask the server for TLS again.

Here's a sample using [ssh2](https://github.com/mscdex/ssh2)

```js
import ssh2 from 'ssh2'

const sql = postgres({
  ...options,
  socket: ({ host: [host], port: [port] }) => new Promise((resolve, reject) => {
    const ssh = new ssh2.Client()
    ssh
    .on('error', reject)
    .on('ready', () =>
      ssh.forwardOut('127.0.0.1', 12345, host, port,
        (err, socket) => err ? reject(err) : resolve(socket)
      )
    )
    .connect(sshOptions)
  })
})
```

## Teardown / Cleanup

To ensure proper teardown and cleanup on server restarts use `await sql.end()` before `process.exit()`.

`await sql.close()` closes every connection once the queries on it have finished, but leaves the pool usable: the next query opens a connection again.

Calling `sql.end()` will reject new queries and return a Promise which resolves when all queries are finished and the underlying connections are closed. If a `{ timeout }` option is provided any pending queries will be rejected once the timeout (in seconds) is reached and the connections will be destroyed.

`await using` ends the pool when it goes out of scope:

```js
{
  await using sql = postgres()
  await sql`select 1`
} // sql.end() has been awaited here
```

For scripts that should exit when their work is done, without calling `sql.end()`, `unref_sockets: true` stops idle connections from keeping the process alive, like `allowExitOnIdle` in node-postgres. Connections with queries in flight still do.

With `min`, the pool keeps that many connections open once it has been used, and `idle_timeout` closes connections only above that number. `sql.close()` lets them close; the next query opens them again.

#### Sample shutdown using [Prexit](https://github.com/porsager/prexit)

```js
import prexit from 'prexit'

prexit(async () => {
  await sql.end({ timeout: 5 })
  await new Promise(r => server.close(r))
})
```

## Reserving connections

### `await sql.reserve()`

The `reserve` method pulls out a connection from the pool, and returns a client that wraps the single connection. This can be used for running queries on an isolated connection.

```ts
const reserved = await sql.reserve()
await reserved`select * from users`
await reserved.release()
```

### `reserved.release()`

Once you have finished with the reserved connection, call `release` to add it back to the pool. `using reserved = await sql.reserve()` releases it when it goes out of scope.

## Tracing

Postgres.js publishes what it does on Node.js [diagnostics channels](https://nodejs.org/api/diagnostics_channel.html), so a tracer or a metrics library can follow every query without an option or a wrapper. Nothing is published while nobody subscribes, and a query costs nothing measurable then. Diagnostics channels are there on Node.js, Bun and Cloudflare Workers.

| Channel | Kind | Published for |
| ------- | ---- | ------------- |
| `postgres:query` | [tracing channel](https://nodejs.org/api/diagnostics_channel.html#class-tracingchannel) | Every query, from when it is sent off until it settles |
| `postgres:connect` | tracing channel | Every attempt to connect to a host, up to a ready connection or an error |
| `postgres:transaction` | tracing channel | Every `sql.begin`, up to its commit or rollback |
| `postgres:pool` | channel | Connections opening, going idle, being leased and released, closing, and queries waiting |
| `postgres:notice` | channel | Every notice from the server |

A tracing channel publishes `start` and `end` around the sending of the query, `error` if it fails, and `asyncStart` and `asyncEnd` when it settles, all with the same context object, which fills in as the query goes along. `start` runs in the async context of the code that made the query, so a span started there gets the right parent.

#### `postgres:query`

| Field | |
| ----- | - |
| `query` | The text sent, with `$1`, `$2` for the parameters |
| `parameters` | The values, only with `debug: true` |
| `statement` | The name it is prepared as, `''` if unnamed |
| `database`, `user` | As connected with |
| `connection`, `host`, `port` | The connection it ran on, once sent |
| `command`, `count` | The command tag and the number of rows, once done |
| `queued`, `sent`, `firstByte`, `complete` | Times in milliseconds from `performance.now()` |
| `result`, `error` | What it resolved or rejected with |

#### `postgres:connect`

`host`, `port`, `path`, `database`, `user`, `ssl` and `sslnegotiation`, then `result` with the backend `pid`, `status`, `readOnly` and `standby`, or `error`.

#### `postgres:transaction`

`mode`, `database`, `user`, `connection`, `host`, `port`, and `outcome`: `'commit'`, `'rollback'` or `'prepare'`.

#### `postgres:pool` and `postgres:notice`

Pool messages have an `event` (`open`, `idle`, `wait`, `lease`, `release` or `close`), the `connection`, `host`, `port` and `database`, and the pool's `stats` at that moment. `lease` and `release` also have the `kind` of lease and `lease` how many milliseconds it `waited`; `close` has the `error`. Notices come as `{ notice, connection, host, port, database }`.

#### OpenTelemetry

Spans following the [semantic conventions for PostgreSQL](https://opentelemetry.io/docs/specs/semconv/db/postgresql/) take a few lines:

```js
import dc from 'node:diagnostics_channel'
import { trace, SpanKind, SpanStatusCode } from '@opentelemetry/api'

const tracer = trace.getTracer('postgres.js')
const spans = new WeakMap()

dc.tracingChannel('postgres:query').subscribe({
  start(x) {
    spans.set(x, tracer.startSpan(x.database, {
      kind: SpanKind.CLIENT,
      attributes: {
        'db.system.name': 'postgresql',
        'db.namespace': x.database,
        'db.query.text': x.query ?? undefined
      }
    }))
  },
  error(x) {
    const span = spans.get(x)
    span.recordException(x.error)
    span.setStatus({ code: SpanStatusCode.ERROR, message: x.error.message })
    span.setAttribute('error.type', x.error.code || x.error.name)
    x.error.severity && span.setAttribute('db.response.status_code', x.error.code)
  },
  asyncEnd(x) {
    const span = spans.get(x)
    span.setAttributes({
      'db.query.text': x.query ?? undefined,
      'db.operation.name': x.command ?? undefined,
      'db.response.returned_rows': x.count ?? undefined,
      'server.address': x.host ?? undefined,
      'server.port': x.port ?? undefined
    })
    x.command && span.updateName(x.command + ' ' + x.database)
    span.end()
  },
  end() {},
  asyncStart() {}
})
```

#### Metrics

```js
import dc from 'node:diagnostics_channel'

dc.subscribe('tracing:postgres:query:asyncEnd', x => {
  histogram.record(x.complete - x.queued, { command: x.command, error: !!x.error })
})

dc.subscribe('postgres:pool', x => {
  gauge.record(x.stats.waiting)
})
```

## Error handling

Errors are all thrown to related queries and never globally. Errors coming from database itself are always in the [native Postgres format](https://www.postgresql.org/docs/current/errcodes-appendix.html), and the same goes for any [Node.js errors](https://nodejs.org/api/errors.html#errors_common_system_errors) eg. coming from the underlying connection.

The stack of a query error leads to the line in your code that made the query, not into Postgres.js, even when the error comes back long after it was sent.

Query errors will also contain the `query` string and the `parameters`. These are not enumerable to avoid accidentally leaking confidential information in logs. To log these it is required to specifically access `error.query` and `error.parameters`, or set `debug: true` in options.

An error from the server is a `PostgresError`, with the fields of the server's [error message](https://www.postgresql.org/docs/current/protocol-error-fields.html) as properties:

```js
import postgres, { PostgresError } from 'postgres'

try {
  await sql`insert into users ${ sql(user) }`
} catch (error) {
  if (error instanceof PostgresError && error.code === '23505')
    return { taken: error.constraint_name }
  throw error
}
```

| Property | |
| --- | --- |
| `code` | The [SQLSTATE](https://www.postgresql.org/docs/current/errcodes-appendix.html), such as `'23505'` for a unique violation |
| `message`, `severity`, `severity_local` | Always there |
| `detail`, `hint`, `position`, `where` | When the server sends them |
| `schema_name`, `table_name`, `column_name`, `data_type_name`, `constraint_name` | For errors about a specific object |
| `file`, `line`, `routine` | Where in the server it happened |
| `query`, `parameters`, `types` | The query that failed; not enumerable unless `debug` is on |

`JSON.stringify(error)` includes the message and every enumerable field.

Errors from the connection are Node.js errors such as `ECONNREFUSED`, or one with a `code` from the list below. Every error Postgres.js throws has a `code`.

There are also the following errors specifically for this library.

##### UNSAFE_TRANSACTION
> Only use sql.begin, sql.reserved or max: 1

To ensure statements in a transaction runs on the same connection (which is required for them to run inside the transaction), you must use [`sql.begin(...)`](#transactions), a [reserved connection](#reserving-connections) or only allow a single connection in options (`max: 1`). A query on the pool that leaves its connection in a transaction is rolled back and rejected with this error. A query that looks like it may start a transaction runs alone on its connection, so no other query ends up in it, and one that opens and closes its own transaction, such as a migration file with `BEGIN` and `COMMIT`, runs as it is.

##### UNDEFINED_VALUE
> Undefined values are not allowed

Postgres.js won't accept `undefined` as values in tagged template queries since it becomes ambiguous what to do with the value. If you want to set something to null, use `null` explicitly.

##### MESSAGE_NOT_SUPPORTED
> X (X) is not supported

Whenever a message is received from Postgres which is not supported by this library. Feel free to file an issue if you think something is missing.

##### PROTOCOL_ERROR
> The server sent a message with an invalid length (-1)

The server, or something between it and Postgres.js, sent a message whose length is below 4 bytes or above 1 GiB. The connection is closed, and its queries reject with this error or with a connection error caused by it.

##### NUL_CHARACTER
> The connection parameter database contains a NUL character

A connection parameter such as `database`, `user` or `application_name` contains `\0`. The startup message separates parameters with NUL, so the rest would be read as more parameters; the connection is refused instead.

##### MAX_PARAMETERS_EXCEEDED
> Max number of parameters (65534) exceeded

The postgres protocol doesn't allow more than 65534 (16bit) parameters. If you run into this issue there are various workarounds such as using `sql([...])` to escape values instead of passing them as parameters.

##### SASL_SIGNATURE_MISMATCH
> Message type X not supported

When using SASL authentication the server responds with a signature at the end of the authentication flow which needs to match the one on the client. This is to avoid [man-in-the-middle attacks](https://en.wikipedia.org/wiki/Man-in-the-middle_attack). If you receive this error the connection was canceled because the server did not reply with the expected signature.

##### NOT_TAGGED_CALL
> Query not called as a tagged template literal

Making queries has to be done using the sql function as a [tagged template](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals#Tagged_templates). This is to ensure parameters are serialized and passed to Postgres as query parameters with correct types and to avoid SQL injection.

##### AUTH_TYPE_NOT_IMPLEMENTED
> Authentication type X is not supported

Postgres supports many different authentication types. This one is not supported. Cleartext, MD5, SCRAM-SHA-256 and SCRAM-SHA-256-PLUS are.

##### SASL_MECHANISM_NOT_SUPPORTED / SASL_NONCE_MISMATCH
The server offered no SASL mechanism Postgres.js supports (SCRAM-SHA-256 or, over TLS, SCRAM-SHA-256-PLUS), or its answer did not continue the client's nonce, which means something between them interfered.

##### CHANNEL_BINDING_REQUIRED
> channel_binding is require, but the server did not offer it

`channel_binding` is `'require'`, and the connection could not be bound to the server's certificate: it is not over TLS, the server did not offer SCRAM-SHA-256-PLUS, asked for a cleartext or MD5 password (which is then not sent) or authenticated without SCRAM, or the certificate could not be hashed for it.

##### SSL_NOT_SUPPORTED
> The server does not support SSL connections

`ssl` was `require` or stricter and the server has no TLS.

##### SSL_NEGOTIATION_NOT_SUPPORTED
`sslnegotiation: 'direct'` was asked for in Cloudflare Workers, which cannot do it.

##### TRANSACTION_ROLLED_BACK
> The server rolled back the transaction instead of committing it

`sql.begin` sent COMMIT and the server answered that it rolled back instead, so nothing in the transaction was saved.

> The query was not sent, the transaction was rolled back with sql.rollback()

A query, savepoint or nested `sql.begin` was made after `sql.rollback()` in the same transaction or savepoint.

##### ARRAY_REMOVED
> sql.array() is removed in v4, pass the array as it is

Arrays are typed from what they hold, so they need no helper. Add a cast where the server should treat it as something else, like `${ ids }::int[]`.

##### CONNECTION_CLOSED
> write CONNECTION_CLOSED host:port

This error is thrown if the connection was closed without an error. This should not happen during normal operations, so please create an issue if this was unexpected.

##### CONNECTION_ENDED
> write CONNECTION_ENDED host:port

This error is thrown if the user has called [`sql.end()`](#teardown--cleanup) and performed a query afterward.

##### CONNECTION_DESTROYED
> write CONNECTION_DESTROYED host:port

This error is thrown for any queries that were pending when the timeout to [`sql.end({ timeout: X })`](#teardown--cleanup) was reached.

##### QUEUE_TIMEOUT
> Waited more than 5 seconds for a connection

A query, transaction or reserve waited longer than `queue_timeout` for a connection. It was never sent.

##### TYPE_NOT_FOUND
> The type vector does not exist

A custom type given by name was not found when the pool looked it up.

##### NESTED_TRANSACTION_MODE
> A nested transaction runs in a savepoint, which can not change the transaction mode

A nested `sql.begin` was given a mode other than its transaction's, or called `sql.prepare()`.

##### TLS_HANDSHAKE_FAILED
> The TLS connection to host:port was lost before the server answered

On Cloudflare Workers: the TLS handshake could not be completed, most often because the server's certificate is not signed by a publicly trusted CA. Workers always verify the certificate; Hyperdrive connects to such servers for you.

##### NO_COLUMNS
> The insert helper got no columns

An insert or update helper was given an empty object or an empty list of columns, which would make invalid SQL.

##### CONNECT_TIMEOUT
> write CONNECT_TIMEOUT host:port

This error is thrown if the startup phase of the connection (tcp, protocol negotiation, and auth) took more than the default 30 seconds or what was specified using `connect_timeout` or `PGCONNECT_TIMEOUT`.

##### ANSWER_TIMEOUT
> write ANSWER_TIMEOUT host:port

The connection waited longer than `answer_timeout` for an answer without receiving anything from the server, so it was closed and its queries rejected. A query that was sent may still have run.

##### COPY_IN_PROGRESS
> You cannot execute queries during copy

This error is thrown if trying to run a query during a copy operation (writable / readable).

## TypeScript support

`postgres` has TypeScript support. You can pass a row list type for your queries in this way:
```ts
interface User {
  id: number
  name: string
}

const users = await sql<User[]>`SELECT * FROM users`
users[0].id // ok => number
users[1].name // ok => string
users[0].invalid // fails: `invalid` does not exists on `User`
```

However, be sure to check the array length to avoid accessing properties of `undefined` rows:
```ts
const users = await sql<User[]>`SELECT * FROM users WHERE id = ${id}`
if (!users.length)
  throw new Error('Not found')
return users[0]
```

You can also prefer destructuring when you only care about a fixed number of rows.
In this case, we recommend you to prefer using tuples to handle `undefined` properly:
```ts
const [user]: [User?] = await sql`SELECT * FROM users WHERE id = ${id}`
if (!user) // => User | undefined
  throw new Error('Not found')
return user // => User

// NOTE:
const [first, second]: [User?] = await sql`SELECT * FROM users WHERE id = ${id}` // fails: `second` does not exist on `[User?]`
const [first, second] = await sql<[User?]>`SELECT * FROM users WHERE id = ${id}` // don't fail : `second: User | undefined`
```

The types that matter are also exported by name:

```ts
import postgres, { type Sql, type TransactionSql, type Row } from 'postgres'

function users(sql: Sql) {
  return sql<User[]>`select * from users`
}
```

A function that should run on the pool, in a transaction or on a reserved connection alike takes `ISql`, which is what the three have in common:

```ts
import postgres, { type ISql } from 'postgres'

function users(sql: ISql) {
  return sql<User[]>`select * from users`
}

await users(sql)
await sql.begin(sql => users(sql))
```

`PostgresError` is exported by name too, so `import { PostgresError } from 'postgres'` works with `instanceof`.

The types are checked against a test of their own with TypeScript 4.9 and later. Feel free to open an issue if you have trouble with types.

## Upgrading from v3

The API is the same as v3's, and most code runs unchanged. Check these before upgrading.

### Parameter types are decided by the server

v3 typed a `Date` as `timestamptz`, a boolean as `boolean`, a `Buffer` as `bytea`, a `bigint` as `int8` and arrays of these by their first element. v4 sends them without a type and the server decides from the query (see [Parameter types](#parameter-types)). `infer: true` keeps v3's behaviour:

```js
const sql = postgres({ infer: true })
```

Nothing changes for `timestamptz` columns, for values written to a column of their own type, for strings and numbers, or for anything with a cast. What does change:

**Dates and times outside UTC.** When the session's `TimeZone` or the Node.js process isn't UTC:

- A `Date` written to a `timestamp` column, or compared with one, is taken as UTC instead of the session's local time.
- A `Date` written to a `date` column, compared with one or cast with `::date`, takes the day in UTC instead of in the session's time zone, so near midnight it can be a day off.
- A `timestamp` column is read as UTC instead of the process's local time, so rows v3 wrote as local time are read back shifted by the UTC offset.

This query shows whether that concerns you:

```sql
select current_setting('TimeZone') as session_time_zone,
       table_schema, table_name, column_name, data_type
from information_schema.columns
where data_type in ('timestamp without time zone', 'date', 'time without time zone')
  and table_schema not in ('pg_catalog', 'information_schema')
```

If it returns no columns, or the time zone is `UTC` and so is your Node.js process (`TZ=UTC`, the default in most containers), nothing changes. Otherwise use `infer: true`, or move those columns to `timestamptz`, or cast the parameters (`${ date }::timestamptz`).

**Errors that need a cast.** A `Date` given where the query doesn't decide its type is now an error from the server, with the fix in the query:

| Query | Error | With a cast |
| ----- | ----- | ----------- |
| ``date_trunc('day', ${ date })``, `extract`, `to_char`, `to_json`, `jsonb_build_object` | `42725` function is not unique, or `42P18` / `42804` could not determine the type | `${ date }::timestamptz` |
| ``${ date } + interval '1 day'`` | `22007` invalid input syntax for type interval | `${ date }::timestamptz + interval '1 day'` |
| A `Date` written to a `time` column | `22007` invalid input syntax for type time | `${ date }::timestamptz::time` |
| ``${ 2n ** 60n } + 1`` | `22003` out of range for type integer | `${ n }::int8 + 1` |

**Values that come back as text.** A boolean, `Date`, `Buffer` or array that is only selected back, as in ``select ${ true } as x``, comes back as a string, since the server reads it as text; cast it to get the type back. A `Buffer` written to a `text` column is stored as its text instead of `\x` hex, a `Date` written to a `text` column as an ISO string ending in `Z`, and `${ 10n } + 1` gives the number `11` instead of the string `'11'`. A string such as `'yes'` or `'t'` for a `boolean` is now read by the server as `true`; v3 wrote any string for a `boolean` as `false`.

**One more round trip.** A query whose parameters are all dates, booleans, `bigint`s, `Buffer`s or arrays of these is described before its first run on each connection, as queries with strings and numbers already were.

### Everything else

- **Runtimes.** Node.js 20 or later, Bun and Cloudflare Workers; Deno runs the npm package. Postgres.js is an ES module; `require('postgres').default` works on Node.js 20.19 and 22.12 and later.
- **`sql.array()` is removed.** Pass the array as it is, with a cast where the query doesn't decide its type: `${ ids }::int[]`.
- **Transactions are stricter.** A `COMMIT` the server answers with `ROLLBACK` rejects with `TRANSACTION_ROLLED_BACK`, a query on a transaction or reserved connection after it ended rejects, a query that can't be built inside a transaction aborts it, and a `begin` sent outside `sql.begin`, a reserved connection or `max: 1` rejects with `UNSAFE_TRANSACTION` and is rolled back.
- **Domains** are read and written as their base type, so a domain over `int[]` comes back as an array of numbers.
- **`infinity` timestamps** are `Infinity` and `-Infinity` instead of an invalid `Date`.
- **TypeScript.** The types are an ES module with a default export and named types: `import postgres, { type Sql } from 'postgres'`.

The [changelog](./CHANGELOG.md) has every change, with the smaller ones about connections and errors.

## Migration tools

Postgres.js doesn't come with any migration solution since it's way out of scope, but here are some modules that support Postgres.js for migrations:

- https://github.com/porsager/postgres-shift
- https://github.com/lukeed/ley
- https://github.com/JAForbes/pgmg

## Thank you

A really big thank you to [@JAForbes](https://twitter.com/jmsfbs) who introduced me to Postgres and still holds my hand navigating all the great opportunities we have.

Thanks to [@ACXgit](https://twitter.com/andreacoiutti) for initial tests and dogfooding.

Also thanks to [Ryan Dahl](https://github.com/ry) for letting me have the `postgres` npm package name.
