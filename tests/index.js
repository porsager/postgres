import { t, ot, not } from './test.js'
import cp from 'child_process'

import postgres from '../lib/index.js'

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

t('Result is array',
  async() => [true, Array.isArray(await sql`select 1`)]
)

t('Result has count', async() =>
  [1, (await sql`select 1`).count]
)

t('Result has command', async() =>
  ['SELECT', (await sql`select 1`).command]
)

t('Create table', async() =>
  ['CREATE TABLE', (await sql`create table test(int int)`).command]
)

t('Drop table', async() =>
  ['DROP TABLE', (await sql`drop table test`).command]
)

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

    /* c8 ignore next */
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

// If your local db doesn't support ssl this will be tested in CI
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
  await sql`insert into test (x) values (${ sql.point([10, 20]) })`
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
  await sql`insert into test (x) values (${ sql.array([sql.point([10, 20]), sql.point([20, 30])]) })`
  return [30, (await sql`select x from test`)[0].x[1][1]]
}, () => sql`drop table test`)

t('sql file', async() =>
  [1, (await sql.file('./select.sql'))[0].x]
)
/*
t('select column vars', async() => {
  await sql`create table test (x int)`
  await sql`insert into test values (1)`
  return [1, (await sql`select ${ 'x' } from test`)[0].x]
})
*/
t('sql file can stream', async() => {
  let result
  await sql.file('./select.sql')
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

t('transform', async() => {
  const sql = postgres({
    ...options,
    transform: x => x.split('').reverse().join('')
  })

  await sql`create table test (hello_world int)`
  await sql`insert into test values (1)`
  return ['dlrow_olleh', Object.keys((await sql`select * from test`)[0])[0]]
}, () => sql`drop table test`)

t('toPascal', async() => {
  const sql = postgres({
    ...options,
    transform: postgres.toPascal
  })

  await sql`create table test (hello_world int)`
  await sql`insert into test values (1)`
  return ['HelloWorld', Object.keys((await sql`select * from test`)[0])[0]]
}, () => sql`drop table test`)

t('toCamel', async() => {
  const sql = postgres({
    ...options,
    transform: postgres.toCamel
  })

  await sql`create table test (hello_world int)`
  await sql`insert into test values (1)`
  return ['helloWorld', Object.keys((await sql`select * from test`)[0])[0]]
}, () => sql`drop table test`)

t('toKebab', async() => {
  const sql = postgres({
    ...options,
    transform: postgres.toKebab
  })

  await sql`create table test (hello_world int)`
  await sql`insert into test values (1)`
  return ['hello-world', Object.keys((await sql`select * from test`)[0])[0]]
}, () => sql`drop table test`)

t('row helper', async() => {
  const obj = { a: 1, b: 'hello', c: false }
  await sql`create table test (a int, b text, c bool)`
  await sql`insert into test (a, b, c) values ${ sql.row(obj, 'a', 'b', 'c') }`

  const [x] = await sql`select * from test`
  return [true, x.a === 1 && x.b === 'hello' && x.c === false]
}, () => sql`drop table test`)

t('multi rows helper', async() => {
  const obj = { a: 1, b: 'hello', c: false }
  const arr = [obj, obj]

  await sql`create table test (a int, b text, c bool)`
  await sql`insert into test (a, b, c) values ${ sql.rows(arr, 'a', 'b', 'c') }`
  await sql`insert into test (a, b, c) values ${ sql.rows(arr, x => [x.a, x.b, x.c]) }`
  await sql`insert into test (a, b, c) values ${ sql.rows(arr.map(x => [x.a, x.b, x.c])) }`

  const x = await sql`select * from test`
  return [true, x[0].a === 1 && x[0].b === 'hello' && x[0].c === false &&
    x[1].a === 1 && x[1].b === 'hello' && x[1].c === false &&
    x.count === 6
  ]
}, () => sql`drop table test`)

t('unsafe', async() => {
  await sql`create table test (x int)`
  return [1, (await sql.unsafe('insert into test values ($1) returning *', [1]))[0].x]
}, () => sql`drop table test`)

t('unsafe simple', async() => {
  return [1, (await sql.unsafe('select 1 as x', { simple: true }))[0].x]
})

t('listen and notify', async() => {
  const sql = postgres(options)

  return ['world', await new Promise((resolve, reject) =>
    sql.listen('hello', x => {
      resolve(x)
      sql.end()
    })
    .then(() => sql.notify('hello', 'world'))
    .catch(reject)
  )]
})

t('responds with server parameters (application_name)', async() =>
  ['postgres.js', await new Promise((resolve, reject) => postgres({
    ...options,
    onparameter: (k, v) => k === 'application_name' && resolve(v)
  })`select 1`.catch(reject))]
)

t('onconnect', async() => {
  const sql = postgres({
    ...options,
    onconnect: () => 'something'
  })

  return [1, (await sql`select 1 as x`)[0].x]
})

t('onconnect runs first', async() => {
  const results = []
  const sql = postgres({
    ...options,
    onconnect: sql => sql`select 1`.then(() => results.push('onconnect'))
  })

  const x = await sql`select 1 as x`
  results.push(x)

  return ['onconnect', results[0]]
})

t('has server parameters', async() => {
  return ['postgres.js', await new Promise((resolve, reject) => {
    const sql = postgres({
      ...options,
      onconnect: () => resolve(sql.parameters.application_name)
    })
    sql`select 1`.catch(reject)
  })]
})

t('big query body', async() => {
  await sql`create table test (x int)`
  return [1000, (await sql`insert into test values ${
    sql.rows([...Array(1000).keys()].map(x => [x]))
  }`).count]
}, () => sql`drop table test`)

