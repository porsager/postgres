import os from 'os'
import fs from 'fs'
import crypto from 'crypto'
import Url from 'url'
import Connection from './connection.js'
import Queue from './queue.js'
import {
  mergeUserTypes,
  arraySerializer,
  arrayParser,
  inferType,
  toPascal,
  toCamel,
  toKebab,
  errors,
  types
} from './types.js'

Object.assign(Postgres, {
  toPascal,
  toCamel,
  toKebab
})

export default function Postgres(url, options) {
  options = parseOptions(url, options)

  let ready = false
    , ended = null
    , arrayTypesPromise
    , max = Math.max(1, options.max)
    , listener

  const connections = Queue()
      , all = []
      , queries = Queue()
      , listeners = {}
      , typeArrayMap = {}
      , files = {}

  function postgres(xs, ...args) {
    return query({}, getConnection(), xs, args)
  }

  Object.assign(postgres, {
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
      .then(() => {
        connections.push(connection)
        next()
      })

    function scoped(xs, ...args) {
      return query({}, connection, xs, args).catch(reject)
    }
  }

  function next() {
    let x
    let c
    while ((x = queries.shift()) && (c = getConnection(x.fn))) {
      x.fn
        ? transaction(x, c)
        : send(c, x.query, x.xs, x.args)
    }
  }

  function query(query, connection, xs, args) {
    if (!query.raw && (!Array.isArray(xs) || !Array.isArray(xs.raw)))
      throw errors.generic({ message: 'Query not called as a tagged template literal', code: 'NOT_TAGGED_CALL' })

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

  function send(connection, query, xs, args) {
    connection
      ? connection.send(query, query.raw ? parseRaw(xs, args) : parse(xs, args))
      : queries.push({ query, xs, args })
  }

  function getConnection(reserve) {
    const connection = --max >= 0 ? createConnection(options) : connections.shift()
    !options.fifo && !reserve && connection && connections.push(connection)
    connection && (connection.active = !(options.onconnect && !connection.ready))
    return options.onconnect && !connection.ready
      ? instance(options.onconnect, connection)
      : connection
  }

  function createConnection(options) {
    const connection = Connection(options)
    all.push(connection)
    fetchArrayTypes(connection)

    return connection
  }

  function instance(fn, connection) {
    let queries = 0
      , container

    addTypes(scoped, connection)
    connection.onconnect = onconnect

    function scoped(xs, ...args) {
      queries++
      const promise = query({}, connection, xs, args)
      promise.then(finished, finished)
      return promise
    }

    function onconnect() {
      container = fetchArrayTypes().then(() => fn(scoped))
      queries === 0 && finished(queries++)
    }

    function finished() {
      --queries === 0 && Promise.resolve(container).then(() => {
        connections.push(connection)
        connection.active = true
        next()
      })
    }
  }

  function rows(rows, ...args) {
    return {
      rows: typeof args[0] === 'string'
        ? rows.map(x => Array.isArray(x) ? x : args.map(a => x[a])) // pluck
        : typeof args[0] === 'function'
          ? rows.map(x => args[0](x)) // map
          : rows
    }
  }

  function row(row, ...args) {
    return {
      row: args.map(a => row[a])
    }
  }

  function array(value) {
    return {
      type: inferType(value),
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
      notify,
      unsafe,
      array,
      file,
      json,
      rows,
      row
    })

    function notify(channel, payload) {
      return sql`select pg_notify(${ channel }, ${ '' + payload })`
    }

    function unsafe(xs, args, options = {}) {
      if (!Array.isArray(args)) {
        options = args || []
        args = []
      }
      return query({ raw: true, simple: options.simple }, connection || getConnection(), xs, args)
    }

    function file(path) {
      const file = files[path]

      if (typeof file === 'string')
        return query({ raw: true, simple: true }, connection || getConnection(), files[path])

      const q = { raw: true, simple: true }
      const promise = (file || (files[path] = new Promise((resolve, reject) => {
        fs.readFile(path, 'utf8', (err, str) => {
          if (err)
            return reject(err)

          files[path] = str
          resolve(str)
        })
      }))).then((str) => query(q, connection || getConnection(), str))

      promise.stream = fn => (q.stream = fn, promise)

      return promise
    }

    options.types && Object.entries(options.types).forEach(([name, type]) => {
      if (name in sql)
        throw errors.generic({ message: name + ' is a reserved method name', code: 'RESERVED_METHOD_NAME' })

      sql[name] = (x) => ({ type: type.to, value: x })
    })
  }

  function listen(x, fn) {
    if (x.match(/[^a-z0-9_-]/))
      return Promise.reject('Only a-z A-Z 0-9 and - . _ allowed in channel names')

    x in listeners
      ? listeners[x].push(fn)
      : (listeners[x] = [fn])

    return query({ raw: true }, getListener(), 'listen "' + x + '"').then(() => x)
  }

  function getListener() {
    if (listener)
      return listener

    listener = Connection({
      ...options,
      onnotify: (c, x) => c in listeners && listeners[c].forEach(fn => fn(x))
    })
    all.push(listener)
    return listener
  }

  function end({ timeout = null } = {}) {
    if (ended)
      return ended

    let destroy

    if (timeout === 0)
      return ended = Promise.all(all.map(c => c.destroy()))

    return ended = Promise.race([
      all.map(c => c.end())
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

  function parse(xs, args = []) {
    const xargs = []
        , types = []

    let str = xs[0]
    let arg

    for (let i = 1; i < xs.length; i++) {
      arg = args[i - 1]
      str += (!arg
        ? parseValue(arg, xargs, types)
        : arg.rows
          ? parseRows(arg.rows, xargs, types)
          : arg.row
            ? parseRow(arg.row, xargs, types)
            : parseValue(arg, xargs, types)
      ) + xs[i]
    }

    return {
      sig: !xargs.dynamic && types + str,
      str: str.trim(),
      args: xargs
    }
  }

  function parseRows(rows, xargs, types) {
    xargs.dynamic = true
    return rows.map(row => parseRow(row, xargs, types)).join(',')
  }

  function parseRow(row, xargs, types) {
    return '(' + row.map(x => parseValue(x, xargs, types)).join(',') + ')'
  }

  function parseValue(x, xargs, types) {
    const type = getType(x)
    types.push(type.type)
    return '$' + xargs.push(type)
  }

  function getType(x) {
    if (x == null)
      return { type: 0, value: x }

    const value = x.type ? x.value : x
        , type = x.array ? typeArrayMap[x.type || inferType(value)] : (x.type || inferType(value))

    return {
      type,
      value: (options.serializers[type] || types.string.serialize)(value)
    }
  }
}

function parseOptions(uri = {}, options) {
  const o = options || uri
      , env = process.env // eslint-disable-line
      , url = options ? Url.parse(uri, true) : { query: {}, pathname: '' }
      , auth = (url.auth || '').split(':')
      , host = o.hostname || o.host || url.hostname || env.PGHOST || 'localhost'
      , port = o.port || url.port || env.PGPORT || 5432

  return {
    host,
    port,
    path        : o.path || host.indexOf('/') > -1 && host + '/.s.PGSQL.' + port,
    database    : o.database || o.db || url.pathname.slice(1) || env.PGDATABASE || 'postgres',
    user        : o.user || o.username || auth[0] || env.PGUSERNAME || os.userInfo().username,
    pass        : o.pass || o.password || auth[1] || env.PGPASSWORD || '',
    max         : o.max || url.query.max || Math.max(1, os.cpus().length),
    fifo        : o.fifo || url.query.fifo || false,
    transform   : o.transform || (x => x),
    types       : o.types || {},
    ssl         : o.ssl || url.ssl || false,
    timeout     : o.timeout,
    onconnect   : o.onconnect,
    onnotice    : o.onnotice,
    onparameter : o.onparameter,
    none        : crypto.randomBytes(18).toString('base64'),
    connection  : { application_name: 'postgres.js', ...o.connection },
    ...mergeUserTypes(o.types)
  }
}
