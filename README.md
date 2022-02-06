<img align="left" width="440" height="140" alt="Fastest full PostgreSQL nodejs client" src="https://raw.githubusercontent.com/porsager/postgres/master/postgresjs.svg?sanitize=true" />

- [🚀 Fastest full-featured PostgreSQL node client](https://github.com/porsager/postgres-benchmarks#results)
- 🚯 1850 LOC - 0 dependencies
- 🏷 ES6 Tagged Template Strings at the core
- 🏄‍♀️ Simple surface API
- 🖊️ Dynamic query support
- 💬 Chat on [Gitter](https://gitter.im/porsager/postgres)

<br>

## Getting started

<br>
<img height="220" alt="Good UX with Postgres.js" src="https://raw.githubusercontent.com/porsager/postgres/master/demo.gif" />
<br>

### Installation
```bash
$ npm install postgres
```

### Usage
```js
const postgres = require('postgres')
// import postgres from 'postgres'

const sql = postgres({ ...options }) // will default to the same as psql

const insertUser = await sql`
  INSERT INTO users ${
    sql({ name: "Serena", age: 35 })
  } RETURNING *
`;
// [{ name: "Serena", age: 35 }]

const selectUsers = await sql`
  select name, age from users
`
// [{ name: "Serena", age: 35 }, { name: 'Murray', age: 68 }, ...]
```

# Table of Contents

* [Connection](#connection)
* [Queries](#queries)
  * [Select](#select)
  * [Insert](#insert)
  * [Update](#update)
  * [Delete](#delete)
* [Dynamic queries](#dynamic-queries)
  * [Building partial queries](#partial-queries)
  * [WHERE clause](#dynamic-where-clause)
  * [Identifiers](#identifier-and-value-utilities)
* [Advanced query methods](#advanced-query-methods)
  * [`forEach`](#foreach)
  * [`cursor`](#cursor)
  * [`describe`](#describe)
  * [`raw`](#raw)
  * [`file`](#file)
  * [Transactions](#transactions)
* [Custom types](#custom-types)
* [Advanced communication](#advanced-communication)
  * [`LISTEN` and `NOTIFY`](#listen-and-notify)
  * [Subscribe / Realtime](#subscribe-realtime)
* [Connection options](#connection-options)
  * [SSL](#ssl)
  * [Multi-host connection](#multi-host-connections-high-availability-ha)
  * [Connection timeout](#connection-timeout)
  * [Environmental variables](#environmental-variables)
* [Error handling](#error-handling)
* [TypeScript support](#typescript-support)


## Connection 

### `postgres([url], [options])`

You can use either a `postgres://` url connection string or the options to define your database connection properties. Options in the object will override any present in the url.

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

More options can be found in the [Advanced Connection Options section](#advanced-connection-options).

## Queries

### ```sql`` -> Promise```

Postgres.js utilizes [Tagged template functions](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals#Tagged_templates) to process query parameters **before** interpolation. Using this advanced form of template literals benefits developers by:

1. **Enforcing** safe query generation
2. Giving the `sql`` ` function powerful [utility](#insert) and [dynamic parameterization](#dynamic-queries) features.

Any generic value will be serialized according to an inferred type, and replaced by a PostgreSQL protocol placeholder `$1, $2, ...`. This is then sent to the database as a parameter to handle escaping & casting.

All queries will return a `Result` array, mapping column names to each row.

```js

const [new_user] = await sql`
  insert into users (
    name, age
  ) values (
    'Murray', 68
  )

  returning *
`

// new_user = { user_id: 1, name: 'Murray', age: 68 }
```

Please note that queries are executed when `awaited` – or manually by using `.execute`.

#### Query parameters

Parameters are automatically inferred and handled by Postgres so that SQL injection isn't possible. No special handling is necessary, simply use JS tagged template literals as usual. **Dynamic and partial queries can be seen in the [next section]()**.

```js
let searchName = 'Mur'
let searchAge = 60


const users = await sql`
  select
    name,
    age
  from users
  where
    name like ${searchName + '%'}
    and age > ${searchAge}
`

// users = [{ name: 'Murray', age: 68 }]

```

> Be careful with quotation marks here. Because Postgres infers column types, you do not need to wrap your interpolated parameters in quotes like `'${name}'`. This will cause an error because the tagged template replaces `${name}` with `$1` in the query string, leaving Postgres to do the interpolation. If you wrap that in a string, Postgres will see `'$1'` and interpret it as a string as opposed to a parameter.

### Select

```js
const columns = ['name', 'age']

sql`
  select ${
    sql(columns)
  } from users
`

// Is translated into this query:
select "name", "age" from users
```

```js
let resultOne = await sql`
  select user_id, name from users
`
// [{ user_id: 0, name: "Serena" }, { user_id: 1, name: "Murray" }, { user_id: 2, name: "Lysander" }, ...]

resultOne.unshift()

let resultTwo = await sql`
  select user_id from users where user_id IN ${resultOne.map(row => row.user_id)}
`
// [{ user_id: 1, name: 'Murray' }, { user_id: 2, name: "Lysander" }, ...]
```

### Insert

```js
const user = {
  name: 'Murray',
  age: 68
}

sql`
  insert into users ${
    sql(user, 'name', 'age')
  }
`

// Is translated to:
insert into users ("name", "age") values ($1, $2)
```

**You can omit column names and simply execute `sql(user)` to get all the fields from the object as columns**. Be careful to not allow users to supply columns that you do not want to be inserted.

#### Multiple inserts in one query
If you need to insert multiple rows at the same time it's also much faster to do it with a single `insert`. Simply pass an array of objects to `sql()`.

```js
const users = [
  {
    name: 'Murray',
    age: 68,
    garbage: 'ignore'
  }, 
  {
    name: 'Walter',
    age: 78
  }
]

sql`insert into users ${sql(users, 'name', 'age')}`

// Is translated to:
insert into users ("name", "age") values ($1, $2), ($3, $4)

// Omitting column names

users[0] = {
  name: 'Serena',
  age: 35,
}

sql`insert into users ${sql(users)}`

// Is translated to:
insert into users ("name", "age") values ($1, $2), ($3, $4)
```

### Update
This is also useful for update queries 
```js

const user = {
  id: 1,
  name: 'Muray'
}

sql`
  update users set ${
    sql(user, 'name')
  } where 
    user_id = ${user.id}
`

// Is translated to:
update users set "name" = $1 where user_id = $2
```

### Delete

```js

const user = {
  id: 1,
  name: 'Muray'
}

sql`delete from users where user_id = ${user.id}`

// Is translated to:
delete from users where user_id = $1
```

## Dynamic queries

Postgres.js features a powerful dynamic query parser for conditionally appending/omitting query fragments.

This works by nestings a ` sql`` ` call within another ` sql`` ` call.

#### Partial queries

```js
let savedQuery = () => sql`and age > 50`

let isQueryingForAge = true

sql`
  select
   *
  from users 
  where 
    name is not null
    ${isQueryingForAge ?
     savedQuery()
     :
     sql``
    }
`
```

#### Dynamic where clause
```js
sql` 
  select 
    * 
  from users ${id ? 
    sql`where user_id = ${ id }` 
    : 
    sql`` 
  }
`

// Is translated to:
select * from users
// Or
select * from users where user_id = $1
```

#### Dynamic filters
```js
let ageFilter = 50;

sql` 
  select 
    * 
  from users 
  where
   age > ${ageFilter}
  ${id ? 
    sql`and user_id = ${id}` 
    : 
    sql`` 
  }
`

// Is translated to:
select * from users where age > $1
// Or
select * from users where age > $1 and user_id = $2
```

### Identifier and value utilities

#### Arrays
Arrays will be handled by replacement parameters too, so `where in` queries are also simple.

```js
const users = await sql`
  select
    *
  from users
  where age in ${sql([68, 75, 23])}
`
```

#### SQL functions

```js
let now = true

sql` 
  update users set updated_at = ${ now ? sql`now()` : someDate }
`
```

#### Table names

```js
const table = 'users'

sql`
  select id from ${ sql(table) }
`
```

## Advanced query methods

### forEach
#### ```sql``.forEach(fn) -> Promise```

If you want to handle rows returned by a query one by one, you can use `.forEach` which returns a promise that resolves once there are no more rows.
```js

await sql`
  select created_at, name from events
`.forEach(row => {
  // row = { created_at: '2019-11-22T14:22:00Z', name: 'connected' }
})

// No more rows
```

### Cursor 
#### ```sql``.cursor([rows = 1], fn) -> Promise```

Use cursors if you need to throttle the amount of rows being returned from a query. New results won't be requested until the promise / async callback function has resolved.

```js
for await (const [row] of sql`select * from generate_series(1,4) as x`.cursor()) {
  // row = { x: 1 }
  await http.request('https://example.com/wat', { row })
}

// All rows iterated
```

A single row will be returned by default, but you can also request batches by setting the number of rows desired in each batch as an argument of `.cursor`:

```js
for await (const rows of sql`select * from generate_series(1,1000) as x`.cursor(10)) {
  // rows = [{ x: 1 }, { x: 2 }, ... ]
  await Promise.all(rows.map(row =>
    http.request('https://example.com/wat', { row })
  ))
}
```

If an error is thrown inside the callback function no more rows will be requested and the promise will reject with the thrown error.

You can also stop receiving any more rows early by returning an end token `sql.END` from the callback function.

```js

await sql`
  select * from generate_series(1,1000) as x
`.cursor(row => {
  return Math.random() > 0.9 && sql.END
})

```

### describe 
#### ```sql``.describe([rows = 1], fn) -> Promise```

Rather than executing a given query, `.describe` will return information utilized in the query process. This information can include the query identifier, column types, etc.

This is useful for debugging and analyzing your Postgres queries. Furthermore, **`.describe` will give you access to the final generated query string that would be executed.**

### Raw
#### ```sql``.raw()```

Using `.raw()` will return rows as an array with `Buffer` values for each column, instead of objects.

This can be useful to receive identically named columns, or for specific performance/transformation reasons. The column definitions are still included on the result array, plus access to parsers for each column.

### File
#### `sql.file(path, [args], [options]) -> Promise`

Using a `.sql` file for a query.

The contents will be cached in memory so that the file is only read once.

```js

sql.file(path.join(__dirname, 'query.sql'), [], {
  cache: true // Default true - disable for single shot queries or memory reasons
})

```

### Transactions

#### BEGIN / COMMIT `sql.begin(fn) -> Promise`

Calling `.begin` with a function will return a Promise. This will resolve with the returned value from the function. The function provides a single argument which is `sql` with a context of the newly created transaction. 

`BEGIN` is automatically called, and if the Promise fails `ROLLBACK` will be called. If it succeeds `COMMIT` will be called.

```js

const [user, account] = await sql.begin(async sql => {
  const [user] = await sql`
    insert into users (
      name
    ) values (
      'Alice'
    )
  `

  const [account] = await sql`
    insert into accounts (
      user_id
    ) values (
      ${ user.user_id }
    )
  `

  return [user, account]
})

```

#### SAVEPOINT `sql.savepoint([name], fn) -> Promise`

```js

sql.begin(async sql => {
  const [user] = await sql`
    insert into users (
      name
    ) values (
      'Alice'
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

Do note that you can often achieve the same result using [`WITH` queries (Common Table Expressions)](https://www.postgresql.org/docs/current/queries-with.html) instead of using transactions.

<details>
<summary><code>sql.unsafe</code> - Advanced unsafe use cases</summary>

### Unsafe queries `sql.unsafe(query, [args], [options]) -> promise`

If you know what you're doing, you can use `unsafe` to pass any string you'd like to postgres. Please note that this can lead to sql injection if you're not careful.

```js

sql.unsafe('select ' + danger + ' from users where id = ' + dragons)

```
</details>

## Custom Types

You can add ergonomic support for custom types, or simply pass an object with a `{ type, value }` signature that contains the Postgres `oid` for the type and the correctly serialized value. _(`oid` values for types can be found in the `pg_catalog.pg_types` table.)_

Adding Query helpers is the recommended approach which can be done like this:

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

// Now you can use sql.types.rect() as specified above
const [custom] = sql`
  insert into rectangles (
    name,
    rect
  ) values (
    'wat',
    ${ sql.types.rect({ x: 13, y: 37, width: 42, height: 80 }) }
  )
  returning *
`

// custom = { name: 'wat', rect: { x: 13, y: 37, width: 42, height: 80 } }

```

## Advanced communication

### Listen and notify

When you call `.listen`, a dedicated connection will be created to ensure that you receive notifications in real-time. This connection will be used for any further calls to `.listen`.

`.listen` returns a promise which resolves once the `LISTEN` query to Postgres completes, or if there is already a listener active.

```js

await sql.listen('news', payload => {
  const json = JSON.parse(payload)
  console.log(json.this) // logs 'is'
})

```

Notify can be done as usual in sql, or by using the `sql.notify` method.
```js

sql.notify('news', JSON.stringify({ no: 'this', is: 'news' }))

```

### Subscribe / Realtime

Postgres.js implements the logical replication protocol of PostgreSQL to support subscription to real-time updates of `insert`, `update` and `delete` operations.

> **NOTE** To make this work you must [create the proper publications in your database](https://www.postgresql.org/docs/current/sql-createpublication.html), enable logical replication by setting `wal_level = logical` in `postgresql.conf` and connect using either a replication or superuser.

#### Quick start

##### Create a publication (eg. in migration)
```sql
CREATE PUBLICATION alltables FOR ALL TABLES
```

##### Subscribe to updates
```js
const sql = postgres({ publications: 'alltables' })

const { unsubscribe } = await sql.subscribe('insert:events', row =>
  // tell about new event row over eg. websockets or do something else
)
```

#### Subscribe pattern

You can subscribe to specific operations, tables, or even rows with primary keys.

##### `operation`      `:` `schema` `.` `table` `=` `primary_key`

**`operation`** is one of ``` * | insert | update | delete ``` and defaults to `*`

**`schema`** defaults to `public.`

**`table`** is a specific table name and defaults to `*`

**`primary_key`** can be used to only subscribe to specific rows

#### Examples

```js
sql.subscribe('*',                () => /* everything */ )
sql.subscribe('insert',           () => /* all inserts */ )
sql.subscribe('*:users',          () => /* all operations on the public.users table */ )
sql.subscribe('delete:users',     () => /* all deletes on the public.users table */ )
sql.subscribe('update:users=1',   () => /* all updates on the users row with a primary key = 1 */ )
```

## Teardown / Cleanup

To ensure proper teardown and cleanup on server restarts use `sql.end({ timeout: 0 })` before `process.exit()`.

Calling `sql.end()` will reject new queries and return a Promise which resolves when all queries are finished and the underlying connections are closed. If a timeout is provided any pending queries will be rejected once the timeout is reached and the connections will be destroyed.

#### Sample shutdown using [Prexit](http://npmjs.com/prexit)

```js

import prexit from 'prexit'

prexit(async () => {
  await sql.end({ timeout: 5 })
  await new Promise(r => server.close(r))
})

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

There is currently no guaranteed way to handle `numeric / decimal` types in native Javascript. **These [and similar] types will be returned as a `string`**. The best way this case is to use  [custom types](#custom-types).


## Connection options

### All Postgres options

```js
const sql = postgres('postgres://username:password@host:port/database', {
  host                 : '',            // Postgres ip address[s] or domain name[s]
  port                 : 5432,          // Postgres server port[s]
  path                 : '',            // unix socket path (usually '/tmp')
  database             : '',            // Name of database to connect to
  username             : '',            // Username of database user
  password             : '',            // Password of database user
  ssl                  : false,         // true, prefer, require, tls.connect options
  max                  : 10,            // Max number of connections
  max_lifetime         : null,          // Max lifetime in seconds (more info below)
  idle_timeout         : 0,             // Idle connection timeout in seconds
  connect_timeout      : 30,            // Connect timeout in seconds
  no_prepare           : false,         // No automatic creation of prepared statements
  types                : [],            // Array of custom types, see more below
  onnotice             : fn,            // Defaults to console.log
  onparameter          : fn,            // (key, value) when server param change
  debug                : fn,            // Is called with (connection, query, params)
  transform            : {
    column             : fn,            // Transforms incoming column names
    value              : fn,            // Transforms incoming row values
    row                : fn             // Transforms entire rows
  },
  connection           : {
    application_name   : 'postgres.js', // Default application_name
    ...                                 // Other connection parameters
  },
  target_session_attrs : null,          // Use 'read-write' with multiple hosts to 
                                        // ensure only connecting to primary
  fetch_types          : true,          // Automatically fetches types on connect
                                        // on initial connection.
})
```

Note that `max_lifetime = 60 * (30 + Math.random() * 30)` by default. This resolves to an interval between 45 and 90 minutes to optimize for the benefits of prepared statements **and** working nicely with Linux's OOM killer.

### SSL

Although [vulnerable to MITM attacks](https://security.stackexchange.com/a/229297/174913), a common configuration for the `ssl` option for some cloud providers is to set `rejectUnauthorized` to `false` (if `NODE_ENV` is `production`):

```js
const sql =
  process.env.NODE_ENV === 'production'
    ? // "Unless you're using a Private or Shield Heroku Postgres database, Heroku Postgres does not currently support verifiable certificates"
      // https://help.heroku.com/3DELT3RK/why-can-t-my-third-party-utility-connect-to-heroku-postgres-with-ssl
      postgres({ ssl: { rejectUnauthorized: false } })
    : postgres();
```

For more information regarding `ssl` with `postgres`, check out the [Node.js documentation for tls](https://nodejs.org/dist/latest-v10.x/docs/api/tls.html#tls_new_tls_tlssocket_socket_options).


### Multi-host connections - High Availability (HA)

Multiple connection strings can be passed to `postgres()` in the form of `postgres('postgres://localhost:5432,localhost:5433', ...)`. This works the same as native the `psql` command. Read more at [multiple host uris](https://www.postgresql.org/docs/13/libpq-connect.html#LIBPQ-MULTIPLE-HOSTS)

Connections will be attempted in order of the specified hosts/ports. On a successful connection, all retries will be reset. This ensures that hosts can come up and down seamlessly.

If you specify `target_session_attrs: 'primary'` or `PGTARGETSESSIONATTRS=primary` Postgres.js will only connect to the primary host, allowing for zero downtime failovers.

### The Connection Pool

Connections are created lazily once a query is created. This means that simply doing const `sql = postgres(...)` won't have any effect other than instantiating a new `sql` instance. 

> No connection will be made until a query is made. 

This means that we get a much simpler story for error handling and reconnections. Queries will be sent over the wire immediately on the next available connection in the pool. Connections are automatically taken out of the pool if you start a transaction using `sql.begin()`, and automatically returned to the pool once your transaction is done.

Any query which was already sent over the wire will be rejected if the connection is lost. It'll automatically defer to the error handling you have for that query, and since connections are lazy it'll automatically try to reconnect the next time a query is made. The benefit of this is no weird generic "onerror" handler that tries to get things back to normal, and also simpler application code since you don't have to handle errors out of context.

There are no guarantees about queries executing in order unless using a transaction with `sql.begin()` or setting `max: 1`. Of course doing a series of queries, one awaiting the other will work as expected, but that's just due to the nature of js async/promise handling, so it's not necessary for this library to be concerned with ordering.

### Connection timeout

By default, connections will not close until `.end()` is called. However, it may be useful to have them close automatically when:

- re-instantiating multiple ` sql`` ` instances
- using Postgres.js in a Serverless environment (Lambda, etc.)
- using Postgres.js with a database service that automatically closes connections after some time (see [`ECONNRESET` issue](https://github.com/porsager/postgres/issues/179))

This can be done using the `idle_timeout` or `max_lifetime` options. These configuration options specify the number of seconds to wait before automatically closing an idle connection and the maximum time a connection can exist, respectively.

For example, to close a connection that has either been idle for 2 seconds or exists for 30 seconds:

```js
const sql = postgres({
  idle_timeout: 2,
  max_lifetime: 30
})
```

### Auto fetching of array types

Postgres.js will automatically fetch table/array-type information when it first connects to a database.  

If you have revoked access to `pg_catalog` this feature will no longer work and will need to be disabled.  

You can disable this feature by setting `fetch_types` to `false`.

### Environmental variables

It is also possible to connect to the database without a connection string or any options. Postgres.js will fall back to the common environment variables used by `psql` as in the table below:

```js
const sql = postgres()
```

| Option            | Environment Variables    |
| ----------------- | ------------------------ |
| `host`            | `PGHOST`                 |
| `port`            | `PGPORT`                 |
| `database`        | `PGDATABASE`             |
| `username`        | `PGUSERNAME` or `PGUSER` |
| `password`        | `PGPASSWORD`             |
| `idle_timeout`    | `PGIDLE_TIMEOUT`         |
| `connect_timeout` | `PGCONNECT_TIMEOUT`      |

### Prepared statements

Prepared statements will automatically be created for any queries where it can be inferred that the query is static. This can be disabled by using the `no_prepare` option. For instance — this is useful when [using PGBouncer in `transaction mode`](https://github.com/porsager/postgres/issues/93).

## Error handling

Errors are all thrown to related queries and never globally. Errors coming from PostgreSQL itself are always in the [native Postgres format](https://www.postgresql.org/docs/current/errcodes-appendix.html), and the same goes for any [Node.js errors](https://nodejs.org/api/errors.html#errors_common_system_errors) eg. coming from the underlying connection.

Query errors will contain a stored error with the origin of the query to aid in tracing errors.

Query errors will also contain the `query` string and the `parameters` which are not enumerable to avoid accidentally leaking confidential information in logs. To log these it is required to specifically access `error.query` and `error.parameters`.

There are also the following errors specifically for this library.

##### UNDEFINED_VALUE
> Undefined values are not allowed

Postgres.js won't accept `undefined` as values in tagged template queries since it becomes ambiguous what to do with the value. If you want to set something to null, use `null` explicitly.

##### MESSAGE_NOT_SUPPORTED
> X (X) is not supported

Whenever a message is received from Postgres which is not supported by this library. Feel free to file an issue if you think something is missing.

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
> Auth type X not implemented

Postgres supports many different authentication types. This one is not supported.

##### CONNECTION_CLOSED
> write CONNECTION_CLOSED host:port

This error is thrown if the connection was closed without an error. This should not happen during normal operations, so please create an issue if this was unexpected.

##### CONNECTION_ENDED
> write CONNECTION_ENDED host:port

This error is thrown if the user has called [`sql.end()`](#sql_end) and performed a query afterward.

##### CONNECTION_DESTROYED
> write CONNECTION_DESTROYED host:port

This error is thrown for any queries that were pending when the timeout to [`sql.end({ timeout: X })`](#sql_destroy) was reached.

##### CONNECTION_CONNECT_TIMEOUT
> write CONNECTION_CONNECT_TIMEOUT host:port

This error is thrown if the startup phase of the connection (tcp, protocol negotiation, and auth) took more than the default 30 seconds or what was specified using `connect_timeout` or `PGCONNECT_TIMEOUT`.

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
In this case, we recommand you to prefer using tuples to handle `undefined` properly:
```ts
const [user]: [User?] = await sql`SELECT * FROM users WHERE id = ${id}`
if (!user) // => User | undefined
  throw new Error('Not found')
return user // => User

// NOTE:
const [first, second]: [User?] = await sql`SELECT * FROM users WHERE id = ${id}` // fails: `second` does not exist on `[User?]`
const [first, second] = await sql<[User?]>`SELECT * FROM users WHERE id = ${id}` // don't fail : `second: User | undefined`
```

We do our best to type all the public API, however types are not always updated when features are added ou changed. Feel free to open an issue if you have trouble with types.

## Migration tools

Postgres.js doesn't come with any migration solution since it's way out of scope, but here are some modules that support Postgres.js for migrations:

- https://github.com/porsager/postgres-shift
- https://github.com/lukeed/ley

## Thank you

A really big thank you to [@JAForbes](https://twitter.com/jmsfbs) who introduced me to Postgres and still holds my hand navigating all the great opportunities we have.

Thanks to [@ACXgit](https://twitter.com/andreacoiutti) for initial tests and dogfooding.

Also thanks to [Ryan Dahl](http://github.com/ry) for letting me have the `postgres` npm package name.