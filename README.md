<img align="left" width="440" height="140" alt="Fastest full PostgreSQL nodejs client" src="https://raw.githubusercontent.com/porsager/postgres/master/postgresjs.svg?sanitize=true" />

- [🚀 Fastest full featured PostgreSQL node client](https://github.com/porsager/postgres-benchmarks#results)
- 🚯 1250 LOC - 0 dependencies
- 🏷 ES6 Tagged Template Strings at the core
- 🏄‍♀️ Simple surface API
- 💬 Chat on [Gitter](https://gitter.im/porsager/postgres)

<br>

## Getting started

<br>
<img height="220" alt="Good UX with Postgres.js" src="https://raw.githubusercontent.com/porsager/postgres/master/demo.gif" />
<br>

**Install**
```bash
$ npm install postgres
```

**Use**
```js
// db.js
const postgres = require('postgres')

const sql = postgres({ ...options }) // will default to the same as psql

module.exports = sql
```

```js
// other.js
const sql = require('./db.js')

const users = await sql`
  select name, age from users
`
// users: [{ name: 'Murray', age: 68 }, { name: 'Walter', age: 78 }]
```

## Connection options `postgres([url], [options])`

You can use either a `postgres://` url connection string or the options to define your database connection properties. Options in the object will override any present in the url.

```js
const sql = postgres('postgres://username:password@host:port/database', {
  host            : '',         // Postgres ip address[s] or domain name[s]
  port            : 5432,       // Postgres server port[s]
  path            : '',         // unix socket path (usually '/tmp')
  database        : '',         // Name of database to connect to
  username        : '',         // Username of database user
  password        : '',         // Password of database user
  ssl             : false,      // true, prefer, require, tls.connect options
  max             : 10,         // Max number of connections
  idle_timeout    : 0,          // Idle connection timeout in seconds
  connect_timeout : 30,         // Connect timeout in seconds
  no_prepare      : false,      // No automatic creation of prepared statements
  types           : [],         // Array of custom types, see more below
  onnotice        : fn          // Defaults to console.log
  onparameter     : fn          // (key, value) when server param change
  debug           : fn          // Is called with (connection, query, params)
  transform       : {
    column            : fn, // Transforms incoming column names
    value             : fn, // Transforms incoming row values
    row               : fn  // Transforms entire rows
  },
  connection      : {
    application_name  : 'postgres.js', // Default application_name
    ...                                // Other connection parameters
  },
  target_session_attrs : null   // Use 'read-write' with multiple hosts to 
                                // ensure only connecting to primary
})
```

### SSL
More info for the `ssl` option can be found in the [Node.js docs for tls connect options](https://nodejs.org/dist/latest-v10.x/docs/api/tls.html#tls_new_tls_tlssocket_socket_options).

Although it is [vulnerable to MITM attacks](https://security.stackexchange.com/a/229297/174913), a common configuration for the `ssl` option for some cloud providers like Heroku is to set `rejectUnauthorized` to `false` (if `NODE_ENV` is `production`):

```js
const sql =
  process.env.NODE_ENV === 'production'
    ? // "Unless you're using a Private or Shield Heroku Postgres database, Heroku Postgres does not currently support verifiable certificates"
      // https://help.heroku.com/3DELT3RK/why-can-t-my-third-party-utility-connect-to-heroku-postgres-with-ssl
      postgres({ ssl: { rejectUnauthorized: false } })
    : postgres();
```

### Multi host connections - High Availability (HA)

Connection uri strings with multiple hosts works like in [`psql multiple host uris`](https://www.postgresql.org/docs/13/libpq-connect.html#LIBPQ-MULTIPLE-HOSTS)

Connecting to the specified hosts/ports will be tried in order, and on a successfull connection retries will be reset. This ensures that hosts can come up and down seamless to your application.

If you specify `target_session_attrs: 'read-write'` or `PGTARGETSESSIONATTRS=read-write` Postgres.js will only connect to a writeable host allowing for zero down time failovers.

### Environment Variables for Options

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
' `connect_timeout` | `PGCONNECT_TIMEOUT`      |

## Query ```sql` ` -> Promise```

A query will always return a `Promise` which resolves to a results array `[...]{ rows, command }`. Destructuring is great to immediately access the first element.

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


#### TypeScript support

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
// vs
const [first, second] = await sql<[User?]>`SELECT * FROM users WHERE id = ${id}` // ok but should fail
```

All the public API is typed. Also, TypeScript support is still in beta. Feel free to open an issue if you have trouble with types.

#### Query parameters

Parameters are automatically inferred and handled by Postgres so that SQL injection isn't possible. No special handling is necessary, simply use JS tagged template literals as usual.

```js

let search = 'Mur'

const users = await sql`
  select 
    name, 
    age 
  from users
  where 
    name like ${ search + '%' }
`

// users = [{ name: 'Murray', age: 68 }]

```

Arrays will be handled by replacement parameters too, so `where in` queries are also simple.

```js

const users = await sql`
  select 
    * 
  from users
  where age in (${ [68, 75, 23] })
`

```

## Stream ```sql` `.stream(fn) -> Promise```

If you want to handle rows returned by a query one by one, you can use `.stream` which returns a promise that resolves once there are no more rows.
```js

await sql`
  select created_at, name from events
`.stream(row => {
  // row = { created_at: '2019-11-22T14:22:00Z', name: 'connected' }
})

// No more rows

```

## Cursor ```sql` `.cursor([rows = 1], fn) -> Promise```

Use cursors if you need to throttle the amount of rows being returned from a query. New results won't be requested until the promise / async callback function has resolved.

```js

await sql`
  select * from generate_series(1,4) as x
`.cursor(async row => {
  // row = { x: 1 }
  await http.request('https://example.com/wat', { row })
})

// No more rows

```

A single row will be returned by default, but you can also request batches by setting the number of rows desired in each batch as the first argument. That is usefull if you can do work with the rows in parallel like in this example:

```js

await sql`
  select * from generate_series(1,1000) as x
`.cursor(10, async rows => {
  // rows = [{ x: 1 }, { x: 2 }, ... ]
  await Promise.all(rows.map(row =>
    http.request('https://example.com/wat', { row })
  ))
})

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

## Listen and notify

When you call listen, a dedicated connection will automatically be made to ensure that you receive notifications in real time. This connection will be used for any further calls to listen. Listen returns a promise which resolves once the `LISTEN` query to Postgres completes, or if there is already a listener active.

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

## Tagged template function ``` sql`` ``` 
[Tagged template functions](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals#Tagged_templates) are not just ordinary template literal strings. They allow the function to handle any parameters within before interpolation. This means that they can be used to enforce a safe way of writing queries, which is what Postgres.js does. Any generic value will be serialized according to an inferred type, and replaced by a PostgreSQL protocol placeholders `$1, $2, ...` and then sent to the database as a parameter to let it handle any need for escaping / casting.

This also means you cannot write dynamic queries or concat queries together by simple string manipulation. To enable dynamic queries in a safe way, the `sql` function doubles as a regular function which escapes any value properly. It also includes overloads for common cases of inserting, selecting, updating and querying.

## Dynamic query helpers - `sql()` inside tagged template

Postgres.js has a safe, ergonomic way to aid you in writing queries. This makes it easier to write dynamic `insert`, `select` and `update` queries, and pass `where` parameters.

#### Insert

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

// Is translated into this query:
insert into users (name, age) values ($1, $2)

```

You can leave out the column names and simply do `sql(user)` if you want to get all fields from the object as columns, but be careful not to allow users to supply columns you don't want.

#### Multiple inserts in one query
If you need to insert multiple rows at the same time it's also much faster to do it with a single `insert`. Simply pass an array of objects to `sql()`.

```js

const users = [{
  name: 'Murray',
  age: 68,
  garbage: 'ignore'
}, {
  name: 'Walter',
  age: 78
}]

sql`
  insert into users ${
    sql(users, 'name', 'age')
  }
`
```

#### Update

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
    id = ${ user.id }
`

// Is translated into this query:
update users set name = $1 where id = $2
```

#### Select

```js

const columns = ['name', 'age']

sql`
  select ${
    sql(columns)
  } from users
`

// Is translated into this query:
select name, age from users
```

#### Dynamic table name

```js

const table = 'users'

sql`
  select id from ${sql(table)}
`

// Is translated into this query:
select id from users
```

#### Arrays `sql.array(Array)`

PostgreSQL has a native array type which is similar to js arrays, but only allows the same type and shape for nested items. This method automatically infers the item type and serializes js arrays into PostgreSQL arrays.

```js

const types = sql`
  insert into types (
    integers,
    strings,
    dates,
    buffers,
    multi
  ) values (
    ${ sql.array([1,2,3,4,5]) },
    ${ sql.array(['Hello', 'Postgres']) },
    ${ sql.array([new Date(), new Date(), new Date()]) },
    ${ sql.array([Buffer.from('Hello'), Buffer.from('Postgres')]) },
    ${ sql.array([[[1,2],[3,4]][[5,6],[7,8]]]) },
  )
`

```

#### JSON `sql.json(object)`

```js

const body = { hello: 'postgres' }

const [{ json }] = await sql`
  insert into json (
    body
  ) values (
    ${ sql.json(body) }
  )
  returning body
`

// json = { hello: 'postgres' }
```

## File query `sql.file(path, [args], [options]) -> Promise`

Using an `.sql` file for a query. The contents will be cached in memory so that the file is only read once.

```js

sql.file(path.join(__dirname, 'query.sql'), [], {
  cache: true // Default true - disable for single shot queries or memory reasons
})

```

## Transactions


#### BEGIN / COMMIT `sql.begin(fn) -> Promise`

Calling begin with a function will return a Promise which resolves with the returned value from the function. The function provides a single argument which is `sql` with a context of the newly created transaction. `BEGIN` is automatically called, and if the Promise fails `ROLLBACK` will be called. If it succeeds `COMMIT` will be called.

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

## Types

You can add ergonomic support for custom types, or simply pass an object with a `{ type, value }` signature that contains the Postgres `oid` for the type and the correctly serialized value.

Adding Query helpers is the recommended approach which can be done like this:

```js

const sql = sql({
  types: {
    rect: {
      to        : 1337,
      from      : [1337],
      serialize : ({ x, y, width, height }) => [x, y, width, height],
      parse     : ([x, y, width, height]) => { x, y, width, height }
    }
  }
})

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

Since Node.js v10.4 we can use [`BigInt`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt) to match the PostgreSQL type `bigint` which is returned for eg. `count(*)`. Unfortunately it doesn't work with `JSON.stringify` out of the box, so Postgres.js will return it as a string. 

If you want to use `BigInt` you can add this custom type:

```js
const sql = postgres({
  types: {
    bigint: postgres.BigInt
  }
})
```

There is currently no way to handle `numeric / decimal` in a native way in Javascript, so these and similar will be returned as `string`. You can also handle types like these using [custom types](#types) if you want to.

## The Connection Pool

Connections are created lazily once a query is created. This means that simply doing const `sql = postgres(...)` won't have any effect other than instantiating a new `sql` instance. 

> No connection will be made until a query is made. 

This means that we get a much simpler story for error handling and reconnections. Queries will be sent over the wire immediately on the next available connection in the pool. Connections are automatically taken out of the pool if you start a transaction using `sql.begin()`, and automatically returned to the pool once your transaction is done.

Any query which was already sent over the wire will be rejected if the connection is lost. It'll automatically defer to the error handling you have for that query, and since connections are lazy it'll automatically try to reconnect the next time a query is made. The benefit of this is no weird generic "onerror" handler that tries to get things back to normal, and also simpler application code since you don't have to handle errors out of context.

There are no guarantees about queries executing in order unless using a transaction with `sql.begin()` or setting `max: 1`. Of course doing a series of queries, one awaiting the other will work as expected, but that's just due to the nature of js async/promise handling, so it's not necessary for this library to be concerned with ordering.

### Idle timeout

Connections will by default not close until `.end()` is called, but often it is useful to have them close when there is no activity or if using Postgres.js in eg. Lamdas. This can be done using the `idle_timeout` option to specify the amount of seconds to wait before automatically closing an idle connection.

## Prepared statements

Prepared statements will automatically be created for any queries where it can be inferred that the query is static. This can be disabled by using the `no_prepare` option. For instance — this is useful when [using PGBouncer in `transaction mode`](https://github.com/porsager/postgres/issues/93).

<details><summary><code>sql.unsafe</code> - Advanced unsafe use cases</summary>

### Unsafe queries `sql.unsafe(query, [args], [options]) -> promise`

If you know what you're doing, you can use `unsafe` to pass any string you'd like to postgres. Please note that this can lead to sql injection if you're not careful.

```js

sql.unsafe('select ' + danger + ' from users where id = ' + dragons)

```
</details>

## Errors

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

When using SASL authentication the server responds with a signature at the end of the authentication flow which needs to match the one on the client. This is to avoid [man in the middle attacks](https://en.wikipedia.org/wiki/Man-in-the-middle_attack). If you receive this error the connection was cancelled because the server did not reply with the expected signature.

##### NOT_TAGGED_CALL
> Query not called as a tagged template literal

Making queries has to be done using the sql function as a [tagged template](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals#Tagged_templates). This is to ensure parameters are serialized and passed to Postgres as query parameters with correct types and to avoid SQL injection.

##### AUTH_TYPE_NOT_IMPLEMENTED
> Auth type X not implemented

Postgres supports many different authentication types. This one is not supported.

##### CONNECTION_CLOSED
> write CONNECTION_CLOSED host:port

This error is thrown if the connection was closed without an error. This should not happen during normal operation, so please create an issue if this was unexpected.

##### CONNECTION_ENDED
> write CONNECTION_ENDED host:port

This error is thrown if the user has called [`sql.end()`](#sql_end) and performed a query afterwards.

##### CONNECTION_DESTROYED
> write CONNECTION_DESTROYED host:port

This error is thrown for any queries that were pending when the timeout to [`sql.end({ timeout: X })`](#sql_destroy) was reached.

##### CONNECTION_CONNECT_TIMEOUT
> write CONNECTION_CONNECT_TIMEOUT host:port

This error is thrown if the startup phase of the connection (tcp, protocol negotiation and auth) took more than the default 30 seconds or what was specified using `connect_timeout` or `PGCONNECT_TIMEOUT`.

## Migration tools

Postgres.js doesn't come with any migration solution since it's way out of scope, but here are some modules that supports Postgres.js for migrations:

- https://github.com/lukeed/ley

## Thank you

A really big thank you to [@JAForbes](https://twitter.com/jmsfbs) who introduced me to Postgres and still holds my hand navigating all the great opportunities we have.

Thanks to [@ACXgit](https://twitter.com/andreacoiutti) for initial tests and dogfooding.

Also thanks to [Ryan Dahl](http://github.com/ry) for letting me have the `postgres` npm package name.
