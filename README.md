<img align="left" width="440" height="140" alt="Fastest full PostgreSQL nodejs client" src="https://raw.githubusercontent.com/porsager/postgres/master/postgresjs.svg?sanitize=true" />

- [🚀 Fastest full featured PostgreSQL client for Node.js](https://github.com/porsager/postgres-benchmarks#results)
- 🚯 1250 LOC - 0 dependencies
- 🏷 ES6 Tagged Template Strings at the core
- 🏄‍♀️ Simple surface API

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

const postgres = require('postgres')

const sql = postgres({ ...options }) // will default to the same as psql

await sql`
  select name, age from users
`
// > [{ name: 'Murray', age: 68 }, { name: 'Walter', age 78 }]
```

## Connection options `postgres([url], [options])`

You can use either a `postgres://` url connection string or the options to define your database connection properties. Options in the object will override any present in the url.

```js

const sql = postgres('postgres://username:password@host:port/database', {
  host        : '',         // Postgres ip address or domain name
  port        : 5432,       // Postgres server port
  path        : '',         // unix socket path (usually '/tmp')
  database    : '',         // Name of database to connect to
  username    : '',         // Username of database user
  password    : '',         // Password of database user
  ssl         : false,      // True, or options for tls.connect
  max         : 10,         // Max number of connections
  timeout     : 0,          // Idle connection timeout in seconds
  types       : [],         // Array of custom types, see more below
  onnotice    : fn          // Defaults to console.log
  onparameter : fn          // (key, value) when server param change
  debug       : fn          // Is called with (connection, query, parameters)
  transform   : {
    column            : fn, // Transforms incoming column names
    value             : fn, // Transforms incoming row values
    row               : fn  // Transforms entire rows
  },
  connection  : {
    application_name  : 'postgres.js', // Default application_name
    ...                                // Other connection parameters
  }
})

```

More info for the `ssl` option can be found in the [Node.js docs for tls connect options](https://nodejs.org/dist/latest-v10.x/docs/api/tls.html#tls_new_tls_tlssocket_socket_options)

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

This also means you cannot write dynamic queryes or concat queries together by simple string manipulation. To enable dynamic queries in a safe way, the `sql` function doubles as a regular function which escapes any value properly. It also includes overloads for common cases of inserting, selecting, updating and querying.

## Dynamic query helpers `sql() inside tagged template`

Postgres.js has a safe, ergonomic way to aid you in writing queries. This makes it easier to write dynamic inserts, selects, updates and where queries.

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
.then(([user, account])) => {
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
    ${ sql.types.rect({ x: 13, y: 37: width: 42, height: 80 }) }
  )
  returning *
`

// custom = { name: 'wat', rect: { x: 13, y: 37: width: 42, height: 80 } }

```

## Teardown / Cleanup

To ensure proper teardown and cleanup on server restarts use `sql.end({ timeout: null })` before `process.exit()`

Calling `sql.end()` will reject new queries and return a Promise which resolves when all queries are finished and the underlying connections are closed. If a timeout is provided any pending queries will be rejected once the timeout is reached and the connections will be destroyed.

#### Sample shutdown using [Prexit](http://npmjs.com/prexit)

```js

import prexit from 'prexit'

prexit(async () => {
  await sql.end({ timeout: 5 })
  await new Promise(r => server.close(r))
})

```

## The Connection Pool

Connections are created lazily once a query is created. This means that simply doing const `sql = postgres(...)` won't have any effect other than instantiating a new `sql` instance. 

> No connection will be made until a query is made. 

This means that we get a much simpler story for error handling and reconnections. Queries will be sent over the wire immediately on the next available connection in the pool. Connections are automatically taken out of the pool if you start a transaction using `sql.begin()`, and automatically returned to the pool once your transaction is done.

Any query which was already sent over the wire will be rejected if the connection is lost. It'll automatically defer to the error handling you have for that query, and since connections are lazy it'll automatically try to reconnect the next time a query is made. The benefit of this is no weird generic "onerror" handler that tries to get things back to normal, and also simpler application code since you don't have to handle errors out of context.

There are no guarantees about queries executing in order unless using a transaction with `sql.begin()` or setting `max: 1`. Of course doing a series of queries, one awaiting the other will work as expected, but that's just due to the nature of js async/promise handling, so it's not necessary for this library to be concerned with ordering.

<details><summary><code>sql.unsafe</code> - Advanced unsafe use cases</summary>

### Unsafe queries `sql.unsafe(query, [args], [options]) -> promise`

If you know what you're doing, you can use `unsafe` to pass any string you'd like to postgres. Please note that this can lead to sql injection if you're not careful.

```js

sql.unsafe('select ' + danger + ' from users where id = ' + dragons)

```
</details>

## Errors

Errors are all thrown to related queries and never globally. Errors coming from PostgreSQL itself are always in the [native Postgres format](https://www.postgresql.org/docs/current/errcodes-appendix.html), and the same goes for any [Node.js errors](https://nodejs.org/api/errors.html#errors_common_system_errors) eg. coming from the underlying connection.

There are also the following errors specifically for this library.

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


## Thank you

A really big thank you to [@JAForbes](https://twitter.com/jmsfbs) who introduced me to Postgres and still holds my hand navigating all the great opportunities we have.

Thanks to [@ACXgit](https://twitter.com/andreacoiutti) for initial tests and dogfooding.

Also thanks to [Ryan Dahl](http://github.com/ry) for letting me have the `postgres` npm package name.
