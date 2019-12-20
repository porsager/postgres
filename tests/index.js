const { t, not, ot } = require('./test.js')
const cp = require('child_process')
const path = require('path')

const postgres = require('../lib')

const login = {
  user: 'postgres_js_test'
}

const login_clear = {
  user: 'postgres_js_test_clear',
  pass: 'postgres_js_test_clear'
}

const login_md5 = {
  user: 'postgres_js_test_md5',
  pass: 'postgres_js_test_md5'
}

const login_scram = {
  user: 'postgres_js_test_scram',
  pass: 'postgres_js_test_scram'
}

const options = {
  db: 'postgres_js_test',
  user: login.user,
  pass: login.pass,
  timeout: 0.5,
  max: 1
}

cp.execSync('dropdb ' + options.db + ';createdb ' + options.db)
;[login, login_clear, login_md5, login_scram].forEach(x =>
  cp.execSync('psql -c "grant all on database ' + options.db + ' to ' + x.user + '"')
)

const sql = postgres(options)

t('Result is array', async() =>
  [true, Array.isArray(await sql`select 1`)]
)

t('Result has count', async() =>
  [1, (await sql`select 1`).count]
)

t('Result has command', async() =>
  ['SELECT', (await sql`select 1`).command]
)

t('Create table', async() =>
  ['CREATE TABLE', (await sql`create table test(int int)`).command]
, () => sql`drop table test`)

t('Drop table', async() => {
  await sql`create table test(int int)`
  return ['DROP TABLE', (await sql`drop table test`).command]
})

t('null', async() =>
  [null, (await sql`select ${ null } as x`)[0].x]
)

t('undefined to null', async() =>
  [null, (await sql`select ${ undefined } as x`)[0].x]
)

t('Integer', async() =>
  [1, (await sql`select ${ 1 } as x`)[0].x]
)

t('String', async() =>
  ['hello', (await sql`select ${ 'hello' } as x`)[0].x]
)

t('Boolean', async() =>
  [false, (await sql`select ${ false } as x`)[0].x]
)

t('Date', async() => {
  const now = Date.now()
  return [now, (await sql`select ${ now } as x`)[0].x]
})

t('Json', async() => {
  const x = (await sql`select ${ sql.json({ a: 1, b: 'hello' }) } as x`)[0].x
  return [true, x.a === 1 && x.b === 'hello']
})

t('Array of Integer', async() =>
  [3, (await sql`select ${ sql.array([1, 2, 3]) } as x`)[0].x[2]]
)

t('Array of String', async() =>
  ['c', (await sql`select ${ sql.array(['a', 'b', 'c']) } as x`)[0].x[2]]
)

t('Array of Date', async() => {
  const now = new Date()
  return [now.getTime(), (await sql`select ${ sql.array([now, now, now]) } as x`)[0].x[2].getTime()]
})

t('Nested array n2', async() =>
  [4, (await sql`select ${ sql.array([[1, 2], [3, 4]]) } as x`)[0].x[1][1]]
)

t('Nested array n3', async() =>
  [6, (await sql`select ${ sql.array([[[1, 2]], [[3, 4]], [[5, 6]]]) } as x`)[0].x[2][0][1]]
)

t('Escape in arrays', async() =>
  ['Hello "you",c:\\windows', (await sql`select ${ sql.array(['Hello "you"', 'c:\\windows']) } as x`)[0].x.join(',')]
)

t('Escapes', async() => {
  return ['hej"hej', Object.keys((await sql`select 1 as ${ sql('hej"hej') }`)[0])[0]]
})

t('null for int', async() => {
  await sql`create table test (x int)`
  return [1, (await sql`insert into test values(${ null })`).count]
}, () => sql`drop table test`)

t('Transaction throws', async() => {
  await sql`create table test (a int)`
  return ['22P02', await sql.begin(async sql => {
    await sql`insert into test values(1)`
    await sql`insert into test values('hej')`
  }).catch(x => x.code)]
}, () => sql`drop table test`)

t('Transaction rolls back', async() => {
  await sql`create table test (a int)`
  await sql.begin(async sql => {
    await sql`insert into test values(1)`
    await sql`insert into test values('hej')`
  }).catch(() => { /* ignore */ })
  return [0, (await sql`select a from test`).count]
}, () => sql`drop table test`)

t('Transaction throws on uncaught savepoint', async() => {
  await sql`create table test (a int)`

  return ['fail', (await sql.begin(async sql => {
    await sql`insert into test values(1)`
    await sql.savepoint(async sql => {
      await sql`insert into test values(2)`
      throw new Error('fail')
    })

    await sql`insert into test values(3)`
  }).catch(() => 'fail'))]
}, () => sql`drop table test`)

t('Transaction succeeds on uncaught savepoint', async() => {
  await sql`create table test (a int)`
  await sql.begin(async sql => {
    await sql`insert into test values(1)`
    await sql.savepoint(async sql => {
      await sql`insert into test values(2)`
      throw new Error('please rollback')
    }).catch(() => { /* ignore */ })
    await sql`insert into test values(3)`
  })

  return [2, (await sql`select count(1) from test`)[0].count]
}, () => sql`drop table test`)

t('Helpers in Transaction', async() => {
  return [1, (await sql.begin(async sql =>
    await sql`select ${ sql({ x: 1 }) }`
  ))[0].x]
})

t('Throw syntax error', async() =>
  ['42601', (await sql`wat 1`.catch(x => x)).code]
)

t('Connect using uri', async() =>
  [true, await new Promise((resolve, reject) => {
    const sql = postgres('postgres://' + login.user + ':' + (login.pass || '') + '@localhost:5432/' + options.db, {
      timeout: 0.1
    })
    sql`select 1`.then(() => resolve(true), reject)
  })]
)

t('Fail with proper error on no host', async() =>
  ['ECONNREFUSED', (await new Promise((resolve, reject) => {
    const sql = postgres('postgres://localhost:33333/' + options.db, {
      timeout: 0.1
    })
    sql`select 1`.then(reject, resolve)
  })).code]
)

t('Connect using SSL', async() =>
  [true, (await new Promise((resolve, reject) => {
    postgres({
      ssl: { rejectUnauthorized: false },
      timeout: 0.1
    })`select 1`.then(() => resolve(true), reject)
  }))]
)

t('Login without password', async() => {
  return [true, (await postgres({ ...options, ...login })`select true as x`)[0].x]
})

t('Login using cleartext', async() => {
  return [true, (await postgres({ ...options, ...login_clear })`select true as x`)[0].x]
})

t('Login using MD5', async() => {
  return [true, (await postgres({ ...options, ...login_md5 })`select true as x`)[0].x]
})

t('Login using scram-sha-256', async() => {
  return [true, (await postgres({ ...options, ...login_scram })`select true as x`)[0].x]
})

t('Point type', async() => {
  const sql = postgres({
    ...options,
    types: {
      point: {
        to: 600,
        from: [600],
        serialize: ([x, y]) => '(' + x + ',' + y + ')',
        parse: (x) => x.slice(1, -1).split(',').map(x => +x)
      }
    }
  })

  await sql`create table test (x point)`
  await sql`insert into test (x) values (${ sql.types.point([10, 20]) })`
  return [20, (await sql`select x from test`)[0].x[1]]
}, () => sql`drop table test`)

t('Point type array', async() => {
  const sql = postgres({
    ...options,
    types: {
      point: {
        to: 600,
        from: [600],
        serialize: ([x, y]) => '(' + x + ',' + y + ')',
        parse: (x) => x.slice(1, -1).split(',').map(x => +x)
      }
    }
  })

  await sql`create table test (x point[])`
  await sql`insert into test (x) values (${ sql.array([sql.types.point([10, 20]), sql.types.point([20, 30])]) })`
  return [30, (await sql`select x from test`)[0].x[1][1]]
}, () => sql`drop table test`)

t('sql file', async() =>
  [1, (await sql.file(path.join(__dirname, 'select.sql')))[0].x]
)

t('sql file can stream', async() => {
  let result
  await sql.file(path.join(__dirname, 'select.sql'))
    .stream(({ x }) => result = x)

  return [1, result]
})

t('sql file throws', async() =>
  ['ENOENT', (await sql.file('./selectomondo.sql').catch(x => x.code))]
)

t('Connection ended error', async() => {
  const sql = postgres(options)

  sql.end()
  return ['CONNECTION_ENDED', (await sql``.catch(x => x.code))]
})

t('Connection destroyed', async() => {
  const sql = postgres(options)
  setTimeout(() => sql.end({ timeout: 0 }), 0)
  return ['CONNECTION_DESTROYED', await sql``.catch(x => x.code)]
})

t('Message not supported', async() => {
  await sql`create table test (x int)`
  return ['MESSAGE_NOT_SUPPORTED', await sql`copy test to stdout`.catch(x => x.code)]
}, () => sql`drop table test`)

t('transform column', async() => {
  const sql = postgres({
    ...options,
    transform: { column: x => x.split('').reverse().join('') }
  })

  await sql`create table test (hello_world int)`
  await sql`insert into test values (1)`
  return ['dlrow_olleh', Object.keys((await sql`select * from test`)[0])[0]]
}, () => sql`drop table test`)

t('column toPascal', async() => {
  const sql = postgres({
    ...options,
    transform: { column: postgres.toPascal }
  })

  await sql`create table test (hello_world int)`
  await sql`insert into test values (1)`
  return ['HelloWorld', Object.keys((await sql`select * from test`)[0])[0]]
}, () => sql`drop table test`)

t('column toCamel', async() => {
  const sql = postgres({
    ...options,
    transform: { column: postgres.toCamel }
  })

  await sql`create table test (hello_world int)`
  await sql`insert into test values (1)`
  return ['helloWorld', Object.keys((await sql`select * from test`)[0])[0]]
}, () => sql`drop table test`)

t('column toKebab', async() => {
  const sql = postgres({
    ...options,
    transform: { column: postgres.toKebab }
  })

  await sql`create table test (hello_world int)`
  await sql`insert into test values (1)`
  return ['hello-world', Object.keys((await sql`select * from test`)[0])[0]]
}, () => sql`drop table test`)

t('unsafe', async() => {
  await sql`create table test (x int)`
  return [1, (await sql.unsafe('insert into test values ($1) returning *', [1]))[0].x]
}, () => sql`drop table test`)

t('unsafe simple', async() => {
  return [1, (await sql.unsafe('select 1 as x'))[0].x]
})

t('listen and notify', async() => {
  const sql = postgres(options)

  return ['world', await new Promise((resolve, reject) =>
    sql.listen('hello', resolve)
    .then(() => sql.notify('hello', 'world'))
    .catch(reject)
    .then(sql.end)
  )]
})

t('responds with server parameters (application_name)', async() =>
  ['postgres.js', await new Promise((resolve, reject) => postgres({
    ...options,
    onparameter: (k, v) => k === 'application_name' && resolve(v)
  })`select 1`.catch(reject))]
)

t('has server parameters', async() => {
  return ['postgres.js', (await sql`select 1`.then(() => sql.parameters.application_name))]
})

t('big query body', async() => {
  await sql`create table test (x int)`
  return [1000, (await sql`insert into test ${
    sql([...Array(1000).keys()].map(x => ({ x })))
  }`).count]
}, () => sql`drop table test`)

t('Throws if more than 65534 parameters', async() => {
  await sql`create table test (x int)`
  return ['MAX_PARAMETERS_EXCEEDED', (await sql`insert into test ${
    sql([...Array(65535).keys()].map(x => ({ x })))
  }`.catch(e => e.code))]
}, () => sql`drop table test`)

t('let postgres do implicit cast of unknown types', async() => {
  await sql`create table test (x timestamp with time zone)`
  const [{ x }] = await sql`insert into test values (${ new Date().toISOString() }) returning *`
  return [true, x instanceof Date]
}, () => sql`drop table test`)

t('only allows one statement', async() =>
  ['42601', await sql`select 1; select 2`.catch(e => e.code)]
)

t('await sql() throws not tagged error', async() => {
  let error
  try {
    await sql('select 1')
  } catch(e) {
    error = e.code
  }
  return ['NOT_TAGGED_CALL', error]
})

t('sql().then throws not tagged error', async() => {
  let error
  try {
    sql('select 1').then(() => {})
  } catch(e) {
    error = e.code
  }
  return ['NOT_TAGGED_CALL', error]
})

t('sql().catch throws not tagged error', async() => {
  let error
  try {
    sql('select 1').catch(() => {})
  } catch(e) {
    error = e.code
  }
  return ['NOT_TAGGED_CALL', error]
})

t('sql().finally throws not tagged error', async() => {
  let error
  try {
    sql('select 1').finally(() => {})
  } catch(e) {
    error = e.code
  }
  return ['NOT_TAGGED_CALL', error]
})

t('dynamic column name', async () => {
  return ['!not_valid', Object.keys((await sql`select 1 as ${ sql('!not_valid') }`)[0])[0]]
})

t('dynamic select as', async () => {
  return [2, (await sql`select ${ sql({ a: 1, b: 2 }) }`)[0].b]
})

t('dynamic insert', async () => {
  await sql`create table test (a int, b text)`
  const x = { a: 42, b: 'the answer' }

  return ['the answer', (await sql`insert into test ${ sql(x) } returning *`)[0].b]
}, () => sql`drop table test`)

t('dynamic insert pluck', async () => {
  await sql`create table test (a int, b text)`
  const x = { a: 42, b: 'the answer' }

  return [null, (await sql`insert into test ${ sql(x, 'a') } returning *`)[0].b]
}, () => sql`drop table test`)

t('array insert', async () => {
  await sql`create table test (a int, b int)`
  return [2, (await sql`insert into test (a, b) values (${ [1,2] }) returning *`)[0].b]
}, () => sql`drop table test`)

t('parameters in()', async () => {
  return [2, (await sql`
    with rows as (
      select * from (values (1), (2), (3), (4)) as x(a)
    )
    select * from rows where a in (${ [3, 4] })
  `).count]
})

t('dynamic multi row insert', async () => {
  await sql`create table test (a int, b text)`
  const x = { a: 42, b: 'the answer' }

  return ['the answer', (await sql`insert into test ${ sql([x, x]) } returning *`)[1].b]
}, () => sql`drop table test`)

t('dynamic update', async () => {
  await sql`create table test (a int, b text)`
  await sql`insert into test (a, b) values (17, 'wrong')`

  return ['the answer', (await sql`update test set ${ sql({ a: 42, b: 'the answer' }) } returning *`)[0].b]
}, () => sql`drop table test`)

t('dynamic update pluck', async () => {
  await sql`create table test (a int, b text)`
  await sql`insert into test (a, b) values (17, 'wrong')`

  return ['wrong', (await sql`update test set ${ sql({ a: 42, b: 'the answer' }, 'a') } returning *`)[0].b]
}, () => sql`drop table test`)

t('dynamic select array', async () => {
  await sql`create table test (a int, b text)`
  await sql`insert into test (a, b) values (42, 'yay')`
  return ['yay', (await sql`select ${ sql(['a', 'b']) } from test`)[0].b]
}, () => sql`drop table test`)

t('dynamic select args', async () => {
  await sql`create table test (a int, b text)`
  await sql`insert into test (a, b) values (42, 'yay')`
  return ['yay', (await sql`select ${ sql('a', 'b') } from test`)[0].b]
}, () => sql`drop table test`)

t('connection parameters', async() => {
  const sql = postgres({
    ...options,
    connection: {
      'some.var': 'yay'
    }
  })

  return ['yay', (await sql`select current_setting('some.var') as x`)[0].x]
})

t('Multiple queries', async() => {
  const sql = postgres(options)

  return [4, (await Promise.all([
    sql`select 1`,
    sql`select 2`,
    sql`select 3`,
    sql`select 4`
  ])).length]
})

t('Multiple statements', async() =>
  [2, await sql.unsafe(`
    select 1 as x;
    select 2 as x;
  `).then(([, x]) => x.x)]
)

t('throws correct error when authentication fails', async() => {
  const sql = postgres({
    ...options,
    ...login_md5,
    pass: 'wrong'
  })
  return ['28P01', await sql`select 1`.catch(e => e.code)]
})

t('notice works', async() => {
  let notice
  const log = console.log
  console.log = function(x) {
    notice = x
  }

  const sql = postgres({
    ...options
  })

  await sql`create table if not exists users()`
  await sql`create table if not exists users()`

  console.log = log

  return ['NOTICE', notice.severity]
})

t('notice hook works', async() => {
  let notice
  const sql = postgres({
    ...options,
    onnotice: x => notice = x
  })

  await sql`create table if not exists users()`
  await sql`create table if not exists users()`

  return ['NOTICE', notice.severity]
})

t('bytea serializes and parses', async() => {
  const buf = Buffer.from('wat')

  await sql`create table test (x bytea)`
  await sql`insert into test values (${ buf })`

  return [0, Buffer.compare(buf, (await sql`select x from test`)[0].x)]
})
