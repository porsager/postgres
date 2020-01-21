const os = require('os')
const fs = require('fs')
const Url = require('url')
const Connection = require('./connection.js')
const Queue = require('./queue.js')
const {
  mergeUserTypes,
  arraySerializer,
  arrayParser,
  inferType,
  toPascal,
  entries,
  toCamel,
  toKebab,
  errors,
  escape,
  types
} = require('./types.js')

const notPromise = {
  P: {},
  finally: notTagged,
  then: notTagged,
  catch: notTagged
}

function notTagged() {
  throw errors.generic({ message: 'Query not called as a tagged template literal', code: 'NOT_TAGGED_CALL' })
}

Object.assign(Postgres, {
  toPascal,
  toCamel,
  toKebab
})

module.exports = Postgres

function Postgres(a, b) {
  if (arguments.length && !a)
    throw new Error(a + ' - is not a url or connection object')

  const options = parseOptions(a, b)

  const max = Math.max(1, options.max)
      , connections = Queue()
      , all = []
      , queries = Queue()
      , listeners = {}
      , typeArrayMap = {}
      , files = {}
      , isInsert = /(^|[^)(])\s*insert\s+into\s+[^\s]+\s*$/i
      , isSelect = /(^|[^)(])\s*select\s*$/i

  let ready = false
    , ended = null
    , arrayTypesPromise
    , slots = max
    , listener

  function postgres(xs) {
    return query({}, getConnection(), xs, Array.from(arguments).slice(1))
  }

  Object.assign(postgres, {
    options: Object.assign({}, options, { pass: null }),
    parameters: {},
    listen,
    begin,
    end
  })

  addTypes(postgres)

  const onparameter = options.onparameter
  options.onparameter = (k, v) => {
    if (postgres.parameters[k] !== v) {
      postgres.parameters[k] = v
      onparameter && onparameter(k, v)
    }
  }

  return postgres

  function begin(options, fn) {
    if (!fn) {
      fn = options
      options = ''
    }

    return new Promise((resolve, reject) => {
      const connection = getConnection(true)
          , query = { resolve, reject, fn, begin: 'begin ' + options.replace(/[^a-z ]/ig, '') }

      connection
        ? transaction(query, connection)
        : queries.push(query)
    })
  }

  function transaction({
    resolve,
    reject,
    fn,
    begin = '',
    savepoint = ''
  }, connection) {
    begin && (connection.savepoints = 0)
    addTypes(scoped, connection)
    scoped.savepoint = (name, fn) => new Promise((resolve, reject) => {
      transaction({
        savepoint: 'savepoint s' + connection.savepoints++ + '_' + (fn ? name : ''),
        resolve,
        reject,
        fn: fn || name
      }, connection)
    })

    query({ raw: true }, connection, begin || savepoint)
      .then(() => {
        const result = fn(scoped)
        return Array.isArray(result)
          ? Promise.all(result)
          : result
      })
      .then((x) =>
        begin
          ? scoped`commit`.then(() => resolve(x))
          : resolve(x)
      )
      .catch((err) => {
        query({ raw: true }, connection,
          begin
            ? 'rollback'
            : 'rollback to ' + savepoint
        )
        .then(() => reject(err))
      })
      .then(begin && (() => {
        connections.push(connection)
        next()
      }))

    function scoped(xs) {
      return query({}, connection, xs, Array.from(arguments).slice(1))
    }
  }

  function next() {
    let c
      , x

    while (queries.length && (c = getConnection(queries.peek().fn)) && (x = queries.shift())) {
      x.fn
        ? transaction(x, c)
        : send(c, x.query, x.xs, x.args)
    }
  }

  function query(query, connection, xs, args) {
    if (!query.raw && (!Array.isArray(xs) || !Array.isArray(xs.raw)))
      return nested(xs, args)

    const promise = new Promise((resolve, reject) => {
      query.resolve = resolve
      query.reject = reject
      ended !== null
        ? reject(errors.connection('ENDED', options))
        : ready
          ? send(connection, query, xs, args)
          : fetchArrayTypes(connection).then(() => send(connection, query, xs, args)).catch(reject)
    })

    promise.stream = (fn) => (query.stream = fn, promise)

    return promise
  }

  function nested(first, rest) {
    const o = Object.create(notPromise)
    o.first = first
    o.rest = rest
    return o
  }

  function send(connection, query, xs, args) {
    connection
      ? connection.send(query, query.raw ? parseRaw(xs, args) : parse(query, xs, args))
      : queries.push({ query, xs, args })
  }

  function getConnection(reserve) {
    const connection = slots ? createConnection(options) : connections.shift()
    !reserve && connection && connections.push(connection)
    return connection
  }

  function createConnection(options) {
    slots--
    const connection = Connection(options)
    all.push(connection)
    return connection
  }

  function array(value) {
    return {
      type: inferType(value) || 25,
      array: true,
      value
    }
  }

  function json(value) {
    return {
      type: types.json.to,
      value
    }
  }

  function fetchArrayTypes(connection) {
    return arrayTypesPromise || (arrayTypesPromise =
      new Promise((resolve, reject) => {
        send(connection, { resolve, reject, raw: true }, `
          select oid, typelem
          from pg_catalog.pg_type
          where typcategory = 'A'
        `)
      }).then(types => {
        types.forEach(({ oid, typelem }) => addArrayType(oid, typelem))
        ready = true
      })
    )
  }

  function addArrayType(oid, typelem) {
    const parser = options.parsers[typelem]

    typeArrayMap[typelem] = oid
    options.parsers[oid] = (xs) => arrayParser(xs, parser)
    options.parsers[oid].array = true
    options.serializers[oid] = (xs) => arraySerializer(xs, options.serializers[typelem])
  }

  function addTypes(sql, connection) {
    Object.assign(sql, {
      types: {},
      notify,
      unsafe,
      array,
      file,
      json
    })

    function notify(channel, payload) {
      return sql`select pg_notify(${ channel }, ${ '' + payload })`
    }

    function unsafe(xs, args) {
      return query({ raw: true, simple: !args, dynamic: true }, connection || getConnection(), xs, args || [])
    }

    function file(path, args, options = {}) {
      if (!Array.isArray(args)) {
        options = args || {}
        args = null
      }

      if ('cache' in options === false)
        options.cache = true

      const file = files[path]
      const q = { raw: true, simple: !args }

      if (options.cache && typeof file === 'string')
        return query(q, connection || getConnection(), file, args || [])

      const promise = ((options.cache && file) || (files[path] = new Promise((resolve, reject) => {
        fs.readFile(path, 'utf8', (err, str) => {
          if (err)
            return reject(err)

          files[path] = str
          resolve(str)
        })
      }))).then(str => query(q, connection || getConnection(), str, args || []))

      promise.stream = fn => (q.stream = fn, promise)

      return promise
    }

    options.types && entries(options.types).forEach(([name, type]) => {
      sql.types[name] = (x) => ({ type: type.to, value: x })
    })
  }

  function listen(channel, fn) {
    if (channel in listeners) {
      listeners[channel].push(fn)
      return Promise.resolve(channel)
    }

    listeners[channel] = [fn]
    return query({ raw: true }, getListener(), 'listen ' + escape(channel)).then(() => channel)
  }

  function getListener() {
    if (listener)
      return listener

    listener = Connection(Object.assign({},
      options,
      { onnotify: (c, x) => c in listeners && listeners[c].forEach(fn => fn(x)) }
    ))
    all.push(listener)
    return listener
  }

  function end({ timeout = null } = {}) {
    if (ended)
      return ended

    let destroy

    if (timeout === 0)
      return ended = Promise.all(all.map(c => c.destroy())).then(() => undefined)

    return ended = Promise.race([
      Promise.all(all.map(c => c.end()))
    ].concat(
      timeout > 0
        ? new Promise(r => destroy = setTimeout(() => (all.map(c => c.destroy()), r()), timeout * 1000))
        : []
    ))
    .then(() => clearTimeout(destroy))
  }

  function parseRaw(str, args = []) {
    const types = []
        , xargs = args.map(x => {
          const type = getType(x)
          types.push(type.type)
          return type
        })

    return {
      sig: types + str,
      str,
      args: xargs
    }
  }

  function parse(query, xs, args = []) {
    const xargs = []
        , types = []

    let str = xs[0]
    let arg

    for (let i = 1; i < xs.length; i++) {
      arg = args[i - 1]
      str += (arg && arg.P === notPromise.P
        ? parseHelper(str, arg, xargs, types)
        : parseValue(arg, xargs, types)
      ) + xs[i]
    }

    return {
      sig: !query.dynamic && !xargs.dynamic && types + str,
      str: str.trim(),
      args: xargs
    }
  }

  function parseHelper(str, { first, rest }, xargs, types) {
    xargs.dynamic = true
    if (first !== null && typeof first === 'object' && typeof first[0] !== 'string') {
      if (isInsert.test(str))
        return insertHelper(first, rest, xargs, types)
      else if (isSelect.test(str))
        return selectHelper(first, rest, xargs, types)
      else if (!Array.isArray(first))
        return equalsHelper(first, rest, xargs, types)
    }

    return escapeHelper(Array.isArray(first) ? first : [first].concat(rest))
  }

  function selectHelper(first, columns, xargs, types) {
    return entries(first).reduce((acc, [k, v]) =>
      acc + (!columns.length || columns.indexOf(k) > -1
        ? (acc ? ',' : '') + parseValue(v, xargs, types) + ' as ' + escape(k)
        : ''
      )
    , '')
  }

  function insertHelper(first, columns, xargs, types) {
    first = Array.isArray(first) ? first : [first]
    columns = columns.length ? columns : Object.keys(first[0])
    return '(' + escapeHelper(columns) + ') values ' +
    first.reduce((acc, row) =>
      acc + (acc ? ',' : '') + '(' +
        columns.reduce((acc, k) => acc + (acc ? ',' : '') + parseValue(row[k], xargs, types), '') +
      ')'
    , '')
  }

  function equalsHelper(first, columns, xargs, types) {
    return (columns.length ? columns : Object.keys(first)).reduce((acc, k) =>
      acc + (acc ? ',' : '') + escape(k) + ' = ' + parseValue(first[k], xargs, types)
    , '')
  }

  function escapeHelper(xs) {
    return xs.reduce((acc, x) => acc + (acc ? ',' : '') + escape(x), '')
  }

  function parseValue(x, xargs, types) {
    return Array.isArray(x)
      ? x.reduce((acc, x) => acc + (acc ? ',' : '') + addValue(x, xargs, types), '')
      : addValue(x, xargs, types)
  }

  function addValue(x, xargs, types) {
    const type = getType(x)
        , i = types.push(type.type)

    if (i > 65534)
      throw errors.generic({ message: 'Max number of parameters (65534) exceeded', code: 'MAX_PARAMETERS_EXCEEDED' })

    xargs.push(type)
    return '$' + i
  }

  function getType(x) {
    if (x == null)
      return { type: 0, value: x }

    const value = x.type ? x.value : x
        , type = x.array ? typeArrayMap[x.type] : (x.type || inferType(value))

    return {
      type,
      value: (options.serializers[type] || types.string.serialize)(value)
    }
  }
}

function parseOptions(a, b) {
  const env = process.env // eslint-disable-line
      , url = typeof a === 'string' ? Url.parse(a, true) : { query: {}, pathname: '' }
      , o = (typeof a === 'string' ? b : a) || {}
      , auth = (url.auth || '').split(':')
      , host = o.hostname || o.host || url.hostname || env.PGHOST || 'localhost'
      , port = o.port || url.port || env.PGPORT || 5432

  return Object.assign({
    host,
    port,
    path        : o.path || host.indexOf('/') > -1 && host + '/.s.PGSQL.' + port,
    database    : o.database || o.db || (url.pathname || '').slice(1) || env.PGDATABASE || 'postgres',
    user        : o.user || o.username || auth[0] || env.PGUSERNAME || env.PGUSER || os.userInfo().username,
    pass        : o.pass || o.password || auth[1] || env.PGPASSWORD || '',
    max         : o.max || url.query.max || Math.max(1, os.cpus().length),
    types       : o.types || {},
    ssl         : o.ssl || url.ssl || false,
    timeout     : o.timeout,
    onnotice    : o.onnotice,
    onparameter : o.onparameter,
    transform   : Object.assign({}, o.transform),
    connection  : Object.assign({ application_name: 'postgres.js' }, o.connection),
    debug       : o.debug
  },
    mergeUserTypes(o.types)
  )
}
