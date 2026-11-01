import os from 'os'
import fs from 'fs'

import {
  Types,
  Parameter,
  toPascal,
  pascal,
  toCamel,
  camel,
  toKebab,
  kebab,
  fromPascal,
  fromCamel,
  fromKebab
} from './types.js'

import { Identifier, Builder, escapeIdentifier } from './build.js'
import { Query, CLOSE } from './query.js'
import { Pool } from './pool.js'
import { Errors, PostgresError } from './errors.js'
import Subscribe from './subscribe.js'
import largeObject from './large.js'
import { channels, active, start, finish, userName } from './diagnostics.js'

Object.assign(Postgres, {
  PostgresError,
  toPascal,
  pascal,
  toCamel,
  camel,
  toKebab,
  kebab,
  fromPascal,
  fromCamel,
  fromKebab,
  escapeIdentifier,
  BigInt: {
    to: 20,
    from: [20],
    parse: x => BigInt(x),
    serialize: x => x.toString()
  }
})

export default Postgres
export { PostgresError }

function Postgres(a, b) {
  const options = parseOptions(a, b)
      , types = options.shared_types || Types(options)
      , pool = Pool(options, types)
      , subscribe = options.no_subscribe || Subscribe(Postgres, { ...options, shared_types: types })
      , listener = Listen(options)

  if (types.named && options.fetch_types === false)
    throw Errors.generic('TYPE_NOT_FOUND', 'Custom types given by name need fetch_types to look them up')

  options.resolve = types.resolve
  options.parsers = view(types.parsers, types.parser)
  options.serializers = view(types.serializers, types.serializer)

  const sql = Sql(handler)

  Object.defineProperties(sql, {
    parameters: { get: () => options.parameters, enumerable: true },
    stats: { get: () => pool.stats, enumerable: true }
  })

  Object.assign(sql, {
    largeObject: largeObject.bind(null, sql),
    subscribe,
    CLOSE,
    END: CLOSE,
    PostgresError,
    options,
    reserve,
    listen: listener.listen,
    begin,
    close,
    end
  })

  Symbol.asyncDispose && (sql[Symbol.asyncDispose] = () => end())

  return sql

  function handler(q) {
    pool.query(q)
  }

  function Sql(handler) {
    handler.debug = options.debug
    handler.options = options
    handler.cancel = handler.cancel || pool.cancel

    const typed = (value, type) => new Parameter(value, type)

    Object.entries(options.types).forEach(([name, type]) => typed[name] = x => new Parameter(x, type.to))

    Object.assign(sql, {
      types: typed,
      typed,
      unsafe,
      notify,
      array,
      json,
      file
    })

    return sql

    function sql(strings, ...args) {
      return strings && Array.isArray(strings.raw)
        ? new Query(strings, args, handler)
        : typeof strings === 'string' && !args.length
          ? new Identifier(options.transform.column.to ? options.transform.column.to(strings) : strings)
          : new Builder(strings, args)
    }

    function unsafe(string, args = [], options = {}) {
      arguments.length === 2 && !Array.isArray(args) && (options = args, args = [])
      return new Query([string], args, handler, {
        prepare: false,
        ...options,
        simple: 'simple' in options ? options.simple : args.length === 0
      })
    }

    async function notify(channel, payload) {
      return await sql`select pg_notify(${ channel }, ${ '' + payload })`
    }

    function file(path, args = [], options = {}) {
      arguments.length === 2 && !Array.isArray(args) && (options = args, args = [])
      const fileHandler = query => fs.readFile(path, 'utf8', (err, string) => {
        if (err)
          return query.reject(err)
        query.strings = [string]
        handler(query)
      })
      Object.assign(fileHandler, handler)
      return new Query([], args, fileHandler, {
        ...options,
        simple: 'simple' in options ? options.simple : args.length === 0
      })
    }
  }

  function json(x) {
    return new Parameter(x, 3802)
  }

  function array() {
    throw Errors.generic('ARRAY_REMOVED', 'sql.array() is removed in v4, pass the array as it is')
  }

  async function reserve() {
    const lease = await pool.lease('reserve')
        , reserved = Sql(Object.assign(q => lease.send(q), { cancel: pool.cancel }))

    reserved.release = () => lease.release()
    Symbol.dispose && (reserved[Symbol.dispose] = reserved.release)
    Symbol.asyncDispose && (reserved[Symbol.asyncDispose] = async() => reserved.release())
    return reserved
  }

  function begin(mode, fn) {
    !fn && (fn = mode, mode = '')
    if (!active(channels.transaction))
      return transaction(mode, fn, null)

    const context = {
      mode,
      database: options.database,
      user: userName(options),
      connection: null,
      host: null,
      port: null,
      outcome: null
    }
    let promise
    start(channels.transaction, context, () => promise = transaction(mode, fn, context))

    return promise.then(
      result => (finish(channels.transaction, context, null, result), result),
      error => {
        finish(channels.transaction, context, error)
        throw error
      }
    )
  }

  async function transaction(mode, fn, context) {
    const lease = await pool.lease('transaction')

    let savepoints = 0
      , prepare = null

    context && Object.assign(context, {
      connection: lease.connection.id,
      host: lease.connection.host,
      port: lease.connection.port
    })

    try {
      await control(lease, 'begin ' + mode.replace(/[^a-z ]/ig, ''))
      const done = scope(fn)
      done.catch(() => {})
      return await Promise.race([done, lease.closed])
    } finally {
      lease.release()
    }

    async function scope(fn, name, inside, above = () => false) {
      let uncaught
        , result
        , rolled = null
        , after = null

      if (above())
        throw rolledBack()

      const stopped = () => !!rolled || above()
          , scoped = Sql(Object.assign(q => {
            if (stopped())
              return q.reject(after || (after = rolledBack()))
            q.catch(e => uncaught || (uncaught = e))
            lease.send(q)
          }, { cancel: pool.cancel }))

      scoped.savepoint = savepoint
      scoped.begin = nested
      scoped.rollback = () => rolled || (rolled = control(lease, name ? 'rollback to ' + identifier(name) : 'rollback').then(() => {}))
      scoped.prepare = x => {
        if (inside)
          throw Errors.generic('NESTED_TRANSACTION_MODE', 'A nested transaction can not be prepared, only the outermost one')
        prepare = x.replace(/[^a-z0-9$\-_. ]/gi, '')
      }

      name && await control(lease, 'savepoint ' + identifier(name))
      try {
        result = await new Promise((resolve, reject) => {
          const x = fn(scoped)
          Promise.resolve(Array.isArray(x) ? Promise.all(x) : x).then(resolve, reject)
        })
        if (uncaught && !stopped())
          throw uncaught
        if (lease.connection.closed)
          throw lease.error || lease.connection.closed
      } catch (error) {
        context && !name && (context.outcome = 'rollback')
        stopped()
          ? rolled && await rolled.catch(() => {})
          : lease.connection.closed || await control(lease, name ? 'rollback to ' + identifier(name) : 'rollback')
        throw error instanceof PostgresError && error.code === '25P02' && uncaught || error
      }

      if (stopped()) {
        rolled && await rolled
        context && !name && (context.outcome = 'rollback')

        if (after)
          throw after

        return result
      }

      if (!name) {
        const done = await control(lease, prepare ? 'prepare transaction \'' + prepare.replace(/'/g, '\'\'') + '\'' : 'commit')
        context && (context.outcome = prepare ? 'prepare' : done.command === 'COMMIT' ? 'commit' : 'rollback')

        if (!prepare && done.command !== 'COMMIT')
          throw Errors.generic('TRANSACTION_ROLLED_BACK', 'The server rolled back the transaction instead of committing it')
      }

      return result

      function savepoint(name, fn) {
        if (name && Array.isArray(name.raw))
          return savepoint(sql => sql.apply(sql, arguments))

        arguments.length === 1 && (fn = name, name = null)
        return scope(fn, 's' + savepoints++ + (name ? '_' + name : ''), false, stopped)
      }

      async function nested(inner, fn) {
        !fn && (fn = inner, inner = '')

        if (normal(inner) && normal(inner) !== normal(mode))
          throw Errors.generic('NESTED_TRANSACTION_MODE', 'A nested transaction runs in a savepoint, which can not change the transaction mode')

        return scope(fn, 's' + savepoints++, true, stopped)
      }
    }
  }

  function rolledBack() {
    return Errors.generic('TRANSACTION_ROLLED_BACK', 'The query was not sent, the transaction was rolled back with sql.rollback()')
  }

  function normal(x) {
    return (x || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()
  }

  function identifier(x) {
    return '"' + x.replace(/"/g, '""') + '"'
  }

  function control(lease, text) {
    const q = new Query([text], [], Object.assign(q => lease.send(q), { options, cancel: pool.cancel }), { simple: true })
    return q.execute()
  }

  async function end(options) {
    await Promise.all([
      listener.end(),
      subscribe.sql ? subscribe.sql.end({ timeout: 0 }) : null
    ])
    return pool.end(options)
  }

  function close() {
    return pool.close()
  }
}

function Listen(options) {
  const channels = new Map()
  let sql = null
    , closing = null

  return {
    listen,
    end: () => {
      channels.forEach(channel => clearTimeout(channel.timer))
      return closing || (sql ? (closing = sql.end({ timeout: 0 })) : Promise.resolve())
    }
  }

  function connection() {
    return sql || (sql = Postgres({
      ...options,
      max: 1,
      idle_timeout: null,
      max_lifetime: null,
      fetch_types: false,
      no_subscribe: true,
      onclose() {
        if (closing)
          return

        channels.forEach((channel, name) => relisten(channel, name))
      },
      onnotify(channel, payload) {
        channels.has(channel) && [...channels.get(channel).listeners].forEach(l => l.fn(payload))
      }
    }))
  }

  function relisten(channel, name, retries = 0) {
    channel.timer = null
    channel.result = start(name)
    channel.result.then(result => {
      Object.assign(channel.state, result.state)
      channel.listeners.forEach(l => l.onlisten && l.onlisten())
    }, () => {
      if (closing || channels.get(name) !== channel)
        return

      retries++
      const seconds = typeof options.backoff === 'function' ? options.backoff(retries) : options.backoff
      channel.timer = setTimeout(() => !closing && channels.get(name) === channel && relisten(channel, name, retries), seconds * 1000)
    })
  }

  function start(name) {
    const x = connection()
    return x`listen ${ x.unsafe('"' + name.replace(/"/g, '""') + '"') }`
  }

  async function listen(name, fn, onlisten) {
    const listener = { fn, onlisten }
    if (!channels.has(name))
      channels.set(name, { listeners: new Set(), result: start(name), state: {} })

    const channel = channels.get(name)
    channel.listeners.add(listener)
    let result
    try {
      result = await channel.result
    } catch (error) {
      channel.listeners.delete(listener)
      channel.listeners.size || channels.delete(name)
      throw error
    }
    Object.assign(channel.state, result.state)
    listener.onlisten && listener.onlisten()

    return { state: channel.state, unlisten }

    async function unlisten() {
      if (!channel.listeners.delete(listener) || channel.listeners.size)
        return

      channels.get(name) === channel && channels.delete(name)
      const x = sql

      if (closing || !x)
        return

      await x`unlisten ${ x.unsafe('"' + name.replace(/"/g, '""') + '"') }`.catch(e => {
        if (!/^CONNECTION_/.test(e.code))
          throw e
      })
      if (channels.size === 0 && sql === x) {
        sql = null
        await x.end()
      }
    }
  }
}

function parseOptions(a, b) {
  if (a && a.shared)
    return a

  const env = process.env
      , o = (!a || typeof a === 'string' ? b : a) || {}
      , url = parseUrl(a)
      , query = [...url.url.searchParams].reduce((a, [b, c]) => (a[b] = c, a), {})
      , targets = hosts(o, query, url, env)
      , port = o.port || query.port || env.PGPORT || 5432
      , user = o.user || o.username || url.url.username || env.PGUSERNAME || env.PGUSER || osUsername()

  o.no_prepare && (o.prepare = false)
  query.sslmode && (query.ssl = query.sslmode, delete query.sslmode)
  'timeout' in o && (console.log('The timeout option is deprecated, use idle_timeout instead'), o.idle_timeout = o.timeout)
  query.sslrootcert === 'system' && (query.ssl = 'verify-full')

  const ints = ['idle_timeout', 'connect_timeout', 'max_lifetime', 'max_pipeline', 'backoff', 'keep_alive', 'min', 'queue_timeout']
  const defaults = {
    max             : globalThis.Cloudflare ? 3 : 10,
    min             : 0,
    ssl             : false,
    sslnegotiation  : null,
    channel_binding : 'prefer',
    idle_timeout    : null,
    connect_timeout : 30,
    queue_timeout   : 0,
    max_lifetime    : max_lifetime,
    max_pipeline    : 100,
    scheduler       : true,
    backoff         : backoff,
    keep_alive      : 60,
    prepare         : true,
    debug           : false,
    fetch_types     : true,
    infer           : false,
    publications    : 'alltables',
    slot            : null,
    target_session_attrs: null
  }

  const options = {
    host            : targets.map(x => x[0]),
    port            : Array.isArray(port) ? port : targets.map(x => o.port || query.port ? +port : x[1] || +port),
    path            : o.path || targets[0][0].indexOf('/') > -1 && targets[0][0] + '/.s.PGSQL.' + (targets[0][1] || port),
    database        : o.database || o.db || (url.url.pathname || '').slice(1) || env.PGDATABASE || (typeof user === 'function' ? null : user),
    user            : user,
    pass            : o.pass || o.password || url.url.password || env.PGPASSWORD || '',
    ...Object.entries(defaults).reduce(
      (acc, [k, d]) => {
        const value = k in o && o[k] !== undefined ? o[k] : k in query
          ? (query[k] === 'disable' || query[k] === 'false' ? false : query[k])
          : env['PG' + k.toUpperCase()] || d
        acc[k] = typeof value === 'string' && ints.includes(k)
          ? +value
          : value
        return acc
      },
      {}
    ),
    connection      : {
      application_name: env.PGAPPNAME || 'postgres.js',
      ...o.connection,
      ...Object.entries(query).reduce((acc, [k, v]) => (k in defaults || k === 'host' || k === 'port' || (acc[k] = v), acc), {})
    },
    types           : o.types || {},
    target_session_attrs: tsa(o, url.url, env),
    channel_binding : binding(o, url.url, env),
    onnotice        : o.onnotice,
    onnotify        : o.onnotify,
    onclose         : o.onclose,
    onparameter     : o.onparameter,
    socket          : o.socket,
    onread          : o.onread !== false,
    open            : o.open,
    no_subscribe    : o.no_subscribe,
    unref_sockets   : !!o.unref_sockets,
    passfile        : passfile(env),
    shared_types    : o.shared_types,
    transform       : parseTransform(o.transform || { undefined: undefined }),
    parameters      : {},
    shared          : { retries: 0 },
    timers          : o.timers || {
      setTimeout,
      clearTimeout,
      setImmediate,
      clearImmediate,
      now: () => performance.now()
    }
  }

  options.infer = options.infer === true || options.infer === 'true'
  options.max === 1 && (options.scheduler = false)
  return options
}

function tsa(o, url, env) {
  const x = o.target_session_attrs || url.searchParams.get('target_session_attrs') || env.PGTARGETSESSIONATTRS
  if (!x || ['read-write', 'read-only', 'primary', 'standby', 'prefer-standby'].includes(x))
    return x

  throw new Error('target_session_attrs ' + x + ' is not supported')
}

function binding(o, url, env) {
  const x = o.channel_binding || url.searchParams.get('channel_binding') || env.PGCHANNELBINDING || 'prefer'
  if (['disable', 'prefer', 'require'].includes(x))
    return x

  throw new Error('channel_binding ' + x + ' is not supported')
}

function backoff(retries) {
  return (0.5 + Math.random() / 2) * Math.min(3 ** retries / 100, 20)
}

function max_lifetime() {
  return 60 * (30 + Math.random() * 30)
}

function parseTransform(x) {
  return {
    undefined: x.undefined,
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

function parseUrl(url) {
  if (!url || typeof url !== 'string')
    return { url: { searchParams: new Map() }, targets: [] }

  const rest = url.slice(url.indexOf('://') + 3)
      , end = rest.search(/[/?]/)
      , authority = end === -1 ? rest : rest.slice(0, end)
      , at = authority.lastIndexOf('@')
      , userinfo = at === -1 ? '' : authority.slice(0, at)
      , colon = userinfo.indexOf(':')
      , tail = new URL('postgres://x' + (end === -1 ? '' : rest.slice(end)))

  return {
    url: {
      username: decode(colon === -1 ? userinfo : userinfo.slice(0, colon)),
      password: colon === -1 ? '' : decode(userinfo.slice(colon + 1)),
      pathname: decode(tail.pathname),
      searchParams: tail.searchParams
    },
    targets: authority.slice(at + 1) ? split(authority.slice(at + 1), decode) : []
  }
}

function decode(x) {
  try {
    return decodeURIComponent(x)
  } catch (_) {
    return x
  }
}

function hosts(o, query, url, env) {
  const given = o.hostname || o.host || query.host
  if (given)
    return Array.isArray(given) ? given.map(x => [x, null]) : split(given)

  if (url.targets.some(([x]) => x))
    return url.targets

  return split(env.PGHOST || 'localhost').map(([x, p], i) => [x, p || (url.targets[i] && url.targets[i][1]) || null])
}

function split(x, decoded = x => x) {
  return x.split(',').filter(Boolean).map(x => {
    const m = x.match(/^\[([^\]]*)\](?::(\d*))?$/) || x.match(/^([^:]*)(?::(\d*))?$/) || [x, x]
    return [decoded(m[1]), m[2] ? +m[2] : null]
  })
}

function passfile(env) {
  try {
    return env.PGPASSFILE || (process.platform === 'win32'
      ? (env.APPDATA || '') + '\\postgresql\\pgpass.conf'
      : os.homedir() + '/.pgpass')
  } catch (_) {
    return null
  }
}

function osUsername() {
  try {
    return os.userInfo().username
  } catch (_) {
    return process.env.USERNAME || process.env.USER || process.env.LOGNAME
  }
}

function view(known, get) {
  return new Proxy(known, {
    get: (x, oid) => typeof oid === 'symbol' ? x[oid] : get(+oid)
  })
}
