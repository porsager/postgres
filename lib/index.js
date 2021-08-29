const fs = require('fs')
const Url = require('url')
const Stream = require('stream')
const Connection = require('./connection.js')
const Queue = require('./queue.js')
const Subscribe = require('./subscribe.js')
const { errors, PostgresError } = require('./errors.js')
const {
  mergeUserTypes,
  arraySerializer,
  arrayParser,
  fromPascal,
  fromCamel,
  fromKebab,
  inferType,
  toPascal,
  toCamel,
  toKebab,
  entries,
  escape,
  types,
  END
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
  PostgresError,
  toPascal,
  toCamel,
  toKebab,
  fromPascal,
  fromCamel,
  fromKebab,
  BigInt: {
    to: 20,
    from: [20],
    parse: x => BigInt(x), // eslint-disable-line
    serialize: x => x.toString()
  }
})

const originCache = new Map()

module.exports = Postgres

function Postgres(a, b) {
  if (arguments.length && !a)
    throw new Error(a + ' - is not a url or connection object')

  const options = parseOptions(a, b)

  const max = Math.max(1, options.max)
      , subscribe = Subscribe(Postgres, a, b)
      , transform = options.transform
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
    , arrayTypesPromise = options.fetch_types ? null : Promise.resolve([])
    , slots = max
    , listener

  function postgres(xs) {
    return query({ tagged: true, prepare: options.prepare }, getConnection(), xs, Array.from(arguments).slice(1))
  }

  Object.assign(postgres, {
    options: Object.assign({}, options, { pass: null }),
    parameters: {},
    subscribe,
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

    query({}, connection, begin || savepoint)
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
        query({}, connection,
          begin
            ? 'rollback'
            : 'rollback to ' + savepoint
        )
        .then(() => reject(err), reject)
      })
      .then(begin && (() => {
        connections.push(connection)
        next(connection)
      }))

    function scoped(xs) {
      return query({ tagged: true }, connection, xs, Array.from(arguments).slice(1))
    }
  }

  function next() {
    let c
      , x

    while (
      (x = queries.peek())
      && (c = x.query && x.query.connection || getConnection(queries.peek().fn))
      && queries.shift()
    ) {
      x.fn
        ? transaction(x, c)
        : send(c, x.query, x.xs, x.args)

      x.query && x.query.connection && x.query.writable && (c.blocked = true)
    }
  }

  function query(query, connection, xs, args) {
    query.origin = options.debug ? new Error().stack : cachedError(xs)
    query.prepare = 'prepare' in query ? query.prepare : options.prepare
    if (query.tagged && (!Array.isArray(xs) || !Array.isArray(xs.raw)))
      return nested(xs, args)

    const promise = new Promise((resolve, reject) => {
      query.resolve = resolve
      query.reject = reject
      ended !== null
        ? reject(errors.connection('CONNECTION_ENDED', options, options))
        : ready
          ? send(connection, query, xs, args)
          : fetchArrayTypes(connection).then(() => send(connection, query, xs, args)).catch(reject)
    })

    addMethods(promise, query)

    return promise
  }

  function cachedError(xs) {
    if (originCache.has(xs))
      return originCache.get(xs)

    const x = Error.stackTraceLimit
    Error.stackTraceLimit = 4
    originCache.set(xs, new Error().stack)
    Error.stackTraceLimit = x
    return originCache.get(xs)
  }

  function nested(first, rest) {
    const o = Object.create(notPromise)
    o.first = first
    o.rest = rest.reduce((acc, val) => acc.concat(val), [])
    return o
  }

  function send(connection, query, xs, args) {
    connection && (query.connection = connection)
    if (!connection || connection.blocked)
      return queries.push({ query, xs, args, connection })

    connection.blocked = query.blocked
    process.nextTick(connection.send, query, query.tagged ? parseTagged(query, xs, args) : parseUnsafe(query, xs, args))
  }

  function getConnection(reserve) {
    const connection = slots ? createConnection(options) : connections.shift()
    !reserve && connection && connections.push(connection)
    return connection
  }

  function createConnection(options) {
    slots--
    // The options object gets cloned as the as the authentication in the frontend.js mutates the
    // options to persist a nonce and signature, which are unique per connection.
    const connection = Connection({ ...options })
    all.push(connection)
    return connection
  }

  function array(xs) {
    const o = Object.create(notPromise)
    o.array = xs
    return o
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
        send(connection, { resolve, reject, simple: true, tagged: false, prepare: false, origin: new Error().stack }, `
          select b.oid, b.typarray
          from pg_catalog.pg_type a
          left join pg_catalog.pg_type b on b.oid = a.typelem
          where a.typcategory = 'A'
          group by b.oid, b.typarray
          order by b.oid
        `)
      }).catch(err => {
        arrayTypesPromise = null
        throw err
      }).then(types => {
        types.forEach(({ oid, typarray }) => addArrayType(oid, typarray))
        ready = true
      })
    )
  }

  function addArrayType(oid, typarray) {
    const parser = options.parsers[oid]

    typeArrayMap[oid] = typarray
    options.parsers[typarray] = (xs) => arrayParser(xs, parser)
    options.parsers[typarray].array = true
    options.serializers[typarray] = (xs) => arraySerializer(xs, options.serializers[oid])
  }

  function addTypes(sql, connection) {
    Object.assign(sql, {
      END,
      PostgresError,
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

    function unsafe(xs, args, queryOptions) {
      const prepare = queryOptions && queryOptions.prepare || false
      return query({ simple: !args, prepare }, connection || getConnection(), xs, args || [])
    }

    function file(path, args, options = {}) {
      if (!Array.isArray(args)) {
        options = args || {}
        args = null
      }

      if ('cache' in options === false)
        options.cache = true

      const file = files[path]
      const q = { tagged: false, simple: !args }

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

      addMethods(promise, q)

      return promise
    }

    options.types && entries(options.types).forEach(([name, type]) => {
      sql.types[name] = (x) => ({ type: type.to, value: x })
    })
  }

  function addMethods(promise, query) {
    promise.readable = () => readable(promise, query)
    promise.writable = () => writable(promise, query)
    promise.raw = () => (query.raw = true, promise)
    promise.stream = (fn) => (query.stream = fn, promise)
    promise.cursor = cursor(promise, query)
  }

  function cursor(promise, query) {
    return (rows, fn) => {
      if (typeof rows === 'function') {
        fn = rows
        rows = 1
      }
      fn.rows = rows
      query.cursor = fn
      query.simple = false
      return promise
    }
  }

  function readable(promise, query) {
    query.connection
      ? query.connection.blocked = true
      : query.blocked = true

    const read = () => query.connection.socket.isPaused() && query.connection.socket.resume()
    promise.catch(err => query.readable.destroy(err)).then(() => {
      query.connection.blocked = false
      read()
      next()
    })
    return query.readable = new Stream.Readable({ read })
  }

  function writable(promise, query) {
    query.connection
      ? query.connection.blocked = true
      : query.blocked = true
    let error
    query.prepare = false
    query.simple = true
    query.writable = []
    promise.catch(err => error = err).then(() => {
      query.connection.blocked = false
      next()
    })
    return query.readable = new Stream.Duplex({
      read() { /* backpressure handling not possible */ },
      write(chunk, encoding, callback) {
        error
          ? callback(error)
          : query.writable.push({ chunk, callback })
      },
      destroy(error, callback) {
        callback(error)
        query.writable.push({ error })
      },
      final(callback) {
        if (error)
          return callback(error)

        query.writable.push({ chunk: null })
        promise.then(() => callback(), callback)
      }
    })
  }

  function listen(channel, fn) {
    const listener = getListener()

    if (channel in listeners) {
      listeners[channel].push(fn)
      return Promise.resolve(Object.create(listener.result, {
        unlisten: { value: unlisten }
      }))
    }

    listeners[channel] = [fn]

    return query({}, listener.conn, 'listen ' + escape(channel))
      .then((result) => {
        Object.assign(listener.result, result)
        return Object.create(listener.result, {
          unlisten: { value: unlisten }
        })
      })

    function unlisten() {
      if (!listeners[channel])
        return Promise.resolve()

      listeners[channel] = listeners[channel].filter(handler => handler !== fn)

      if (listeners[channel].length)
        return Promise.resolve()

      delete listeners[channel]
      return query({}, getListener().conn, 'unlisten ' + escape(channel)).then(() => undefined)
    }
  }

  function getListener() {
    if (listener)
      return listener

    const conn = Connection(Object.assign({
      onnotify: (c, x) => c in listeners && listeners[c].forEach(fn => fn(x)),
      onclose: () => {
        Object.entries(listeners).forEach(([channel, fns]) => {
          delete listeners[channel]
          Promise.all(fns.map(fn => listen(channel, fn).catch(() => { /* noop */ })))
        })
        listener = null
      }
    },
      options
    ))
    listener = { conn, result: {} }
    all.push(conn)
    return listener
  }

  function end({ timeout = null } = {}) {
    if (ended)
      return ended

    let destroy

    return ended = Promise.race([
      Promise.resolve(arrayTypesPromise).then(() => Promise.all(
        (subscribe.sql ? [subscribe.sql.end({ timeout: 0 })] : []).concat(all.map(c => c.end()))
      ))
    ].concat(
      timeout === 0 || timeout > 0
        ? new Promise(r => destroy = setTimeout(() => (
          subscribe.sql && subscribe.sql.end({ timeout }),
          all.map(c => c.destroy()),
          r()
        ), timeout * 1000))
        : []
    ))
    .then(() => clearTimeout(destroy))
  }

  function parseUnsafe(query, str, args = []) {
    const types = []
        , xargs = []

    args.forEach(x => parseValue(x, xargs, types))

    return {
      sig: query.prepare && types + str,
      str,
      args: xargs
    }
  }

  function parseTagged(query, xs, args = []) {
    const xargs = []
        , types = []

    let str = xs[0]
    let arg

    for (let i = 1; i < xs.length; i++) {
      arg = args[i - 1]
      str += parseArg(str, arg, xargs, types) + xs[i]
    }

    return {
      sig: query.prepare && !xargs.dynamic && types + str,
      str: str.trim(),
      args: xargs
    }
  }

  function parseArg(str, arg, xargs, types) {
    return arg && arg.P === notPromise.P
      ? arg.array
        ? parseArray(arg.array, xargs, types)
        : parseHelper(str, arg, xargs, types)
      : parseValue(arg, xargs, types)
  }

  function parseArray(array, xargs, types) {
    return array.length === 0 ? '\'{}\'' : 'array[' + array.map((x) => Array.isArray(x)
      ? parseArray(x, xargs, types)
      : parseValue(x, xargs, types)
    ).join(',') + ']'
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
        ? (acc ? ',' : '') + parseValue(v, xargs, types) + ' as ' + escape(
          transform.column.to ? transform.column.to(k) : k
        )
        : ''
      ),
      ''
    )
  }

  function insertHelper(first, columns, xargs, types) {
    first = Array.isArray(first) ? first : [first]
    columns = columns.length ? columns : Object.keys(first[0])
    return '(' + escapeHelper(columns) + ') values ' +
    first.reduce((acc, row) =>
      acc + (acc ? ',' : '') + '(' +
        columns.reduce((acc, k) => acc + (acc ? ',' : '') + parseValue(row[k], xargs, types), '') +
      ')',
      ''
    )
  }

  function equalsHelper(first, columns, xargs, types) {
    return (columns.length ? columns : Object.keys(first)).reduce((acc, k) =>
      acc + (acc ? ',' : '') + escape(
        transform.column.to ? transform.column.to(k) : k
      ) + ' = ' + parseValue(first[k], xargs, types),
      ''
    )
  }

  function escapeHelper(xs) {
    return xs.reduce((acc, x) => acc + (acc ? ',' : '') + escape(
      transform.column.to ? transform.column.to(x) : x
    ), '')
  }

  function parseValue(x, xargs, types) {
    if (x === undefined)
      throw errors.generic({ code: 'UNDEFINED_VALUE', message: 'Undefined values are not allowed' })

    return Array.isArray(x)
      ? x.reduce((acc, x) => acc + (acc ? ',' : '') + addValue(x, xargs, types), '')
      : x && x.P === notPromise.P
        ? parseArg('', x, xargs, types)
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
      return { type: 0, value: x, raw: x }

    const value = x.type ? x.value : x
        , type = x.type || inferType(value)

    return {
      type,
      value: (options.serializers[type] || types.string.serialize)(value),
      raw: x
    }
  }
}

function parseOptions(a, b) {
  const env = process.env // eslint-disable-line
      , o = (typeof a === 'string' ? b : a) || {}
      , { url, multihost } = parseUrl(a, env)
      , auth = (url.auth || '').split(':')
      , host = o.hostname || o.host || multihost || url.hostname || env.PGHOST || 'localhost'
      , port = o.port || url.port || env.PGPORT || 5432
      , user = o.user || o.username || auth[0] || env.PGUSERNAME || env.PGUSER || osUsername()

  return Object.assign({
    host            : host.split(',').map(x => x.split(':')[0]),
    port            : host.split(',').map(x => x.split(':')[1] || port),
    path            : o.path || host.indexOf('/') > -1 && host + '/.s.PGSQL.' + port,
    database        : o.database || o.db || (url.pathname || '').slice(1) || env.PGDATABASE || user,
    user            : user,
    pass            : o.pass || o.password || auth[1] || env.PGPASSWORD || '',
    max             : o.max || url.query.max || 10,
    types           : o.types || {},
    ssl             : o.ssl || parseSSL(url.query.sslmode || url.query.ssl) || false,
    idle_timeout    : o.idle_timeout || url.query.idle_timeout || env.PGIDLE_TIMEOUT || warn(o.timeout),
    connect_timeout : o.connect_timeout || url.query.connect_timeout || env.PGCONNECT_TIMEOUT || 30,
    prepare         : 'prepare' in o ? o.prepare : 'no_prepare' in o ? !o.no_prepare : true,
    onnotice        : o.onnotice,
    onparameter     : o.onparameter,
    transform       : parseTransform(o.transform || {}),
    connection      : Object.assign({ application_name: 'postgres.js' }, o.connection),
    target_session_attrs: o.target_session_attrs || url.query.target_session_attrs || env.PGTARGETSESSIONATTRS,
    debug           : o.debug,
    fetch_types     : 'fetch_types' in o ? o.fetch_types : true
  },
    mergeUserTypes(o.types)
  )
}

function parseTransform(x) {
  return {
    column: {
      from: typeof x.column === 'function' ? x.column : x.column && x.column.from,
      to: x.column && x.column.to
    },
    value: {
      from: typeof x.value === 'function' ? x.value : x.value && x.value.from,
      to: x.value && x.value.to
    },
    row: {
      from: typeof x.row === 'function' ? x.row : x.row && x.row.from,
      to: x.row && x.row.to
    }
  }
}

function parseSSL(x) {
  return x !== 'disable' && x !== 'false' && x
}

function parseUrl(url) {
  if (typeof url !== 'string')
    return { url: { query: {} } }

  let host = url
  host = host.slice(host.indexOf('://') + 3)
  host = host.split(/[?/]/)[0]
  host = host.slice(host.indexOf('@') + 1)

  return {
    url: Url.parse(url.replace(host, host.split(',')[0]), true),
    multihost: host.indexOf(',') > -1 && host
  }
}

function warn(x) {
  typeof x !== 'undefined' && console.log('The timeout option is deprecated, use idle_timeout instead') // eslint-disable-line
  return x
}

function osUsername() {
  try {
    return require('os').userInfo().username // eslint-disable-line
  } catch (_) {
    return
  }
}
