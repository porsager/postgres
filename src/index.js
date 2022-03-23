import os from 'os'
import fs from 'fs'
import Stream from 'stream'

import {
  mergeUserTypes,
  inferType,
  Parameter,
  Identifier,
  Builder,
  toPascal,
  toCamel,
  toKebab,
  fromPascal,
  fromCamel,
  fromKebab
} from './types.js'

import Connection from './connection.js'
import { Query, CLOSE } from './query.js'
import Queue from './queue.js'
import { Errors, PostgresError } from './errors.js'
import Subscribe from './subscribe.js'

Object.assign(Postgres, {
  PostgresError,
  toPascal,
  toCamel,
  toKebab,
  fromPascal,
  fromCamel,
  fromKebab,
  BigInt
})

export default Postgres

function Postgres(a, b) {
  const options = parseOptions(a, b)
      , subscribe = Subscribe(Postgres, { ...options })

  let ending = false

  const queries = Queue()
      , connections = [...Array(options.max)].map(() => Connection(options, { onopen, onend, ondrain, onclose }))
      , closed = Queue(connections)
      , reserved = Queue()
      , open = Queue()
      , busy = Queue()
      , full = Queue()
      , ended = Queue()
      , connecting = Queue()
      , queues = { closed, ended, connecting, reserved, open, busy, full }

  const sql = Sql(handler)

  Object.assign(sql, {
    get parameters() { return options.parameters },
    largeObject,
    subscribe,
    CLOSE,
    END: CLOSE,
    PostgresError,
    options,
    listen,
    notify,
    begin,
    end
  })

  return sql

  function Sql(handler, instant) {
    handler.debug = options.debug

    Object.entries(options.types).reduce((acc, [name, type]) => {
      acc[name] = (x) => new Parameter(x, type.to)
      return acc
    }, typed)

    Object.assign(sql, {
      types: typed,
      typed,
      unsafe,
      array,
      json,
      file
    })

    return sql

    function typed(value, type) {
      return new Parameter(value, type)
    }

    function sql(strings, ...args) {
      const query = strings && Array.isArray(strings.raw)
        ? new Query(strings, args, handler, cancel)
        : typeof strings === 'string' && !args.length
          ? new Identifier(options.transform.column.to ? options.transform.column.to(strings) : strings)
          : new Builder(strings, args)
      instant && query instanceof Query && query.execute()
      return query
    }

    function unsafe(string, args = [], options = {}) {
      arguments.length === 2 && !Array.isArray(args) && (options = args, args = [])
      const query = new Query([string], args, handler, cancel, {
        prepare: false,
        ...options,
        simple: 'simple' in options ? options.simple : args.length === 0
      })
      instant && query.execute()
      return query
    }

    function file(path, args = [], options = {}) {
      arguments.length === 2 && !Array.isArray(args) && (options = args, args = [])
      const query = new Query([], args, (query) => {
        fs.readFile(path, 'utf8', (err, string) => {
          if (err)
            return query.reject(err)

          query.strings = [string]
          handler(query)
        })
      }, cancel, {
        ...options,
        simple: 'simple' in options ? options.simple : args.length === 0
      })
      instant && query.execute()
      return query
    }
  }

  async function listen(name, fn) {
    const sql = listen.sql || (listen.sql = Postgres({
      ...options,
      max: 1,
      idle_timeout: null,
      max_lifetime: null,
      fetch_types: false,
      onclose() {
        Object.entries(listen.channels).forEach(([channel, { listeners }]) => {
          delete listen.channels[channel]
          Promise.all(listeners.map(fn => listen(channel, fn).catch(() => { /* noop */ })))
        })
      },
      onnotify(c, x) {
        c in listen.channels && listen.channels[c].listeners.forEach(fn => fn(x))
      }
    }))

    const channels = listen.channels || (listen.channels = {})
        , exists = name in channels
        , channel = exists ? channels[name] : (channels[name] = { listeners: [fn] })

    if (exists) {
      channel.listeners.push(fn)
      return Promise.resolve({ ...channel.result, unlisten })
    }

    channel.result = await sql`listen ${ sql(name) }`
    channel.result.unlisten = unlisten

    return channel.result

    async function unlisten() {
      if (name in channels === false)
        return

      channel.listeners = channel.listeners.filter(x => x !== fn)
      if (channels[name].listeners.length)
        return

      delete channels[name]
      return sql`unlisten ${ sql(name) }`
    }
  }

  async function notify(channel, payload) {
    return await sql`select pg_notify(${ channel }, ${ '' + payload })`
  }

  async function begin(options, fn) {
    !fn && (fn = options, options = '')
    const queries = Queue()
    let savepoints = 0
      , connection

    try {
      await sql.unsafe('begin ' + options.replace(/[^a-z ]/ig, ''), [], { onexecute })
      return await scope(connection, fn)
    } catch (error) {
      throw error
    }

    async function scope(c, fn, name) {
      const sql = Sql(handler, true)
      sql.savepoint = savepoint
      let errored
      name && await sql`savepoint ${ sql(name) }`
      try {
        const result = await new Promise((resolve, reject) => {
          errored = reject
          const x = fn(sql)
          Promise.resolve(Array.isArray(x) ? Promise.all(x) : x).then(resolve, reject)
        })
        !name && await sql`commit`
        return result
      } catch (e) {
        await (name
          ? sql`rollback to ${ sql(name) }`
          : sql`rollback`
        )
        throw e
      }

      function savepoint(name, fn) {
        if (name && Array.isArray(name.raw))
          return savepoint(sql => sql.apply(sql, arguments))

        arguments.length === 1 && (fn = name, name = null)
        return scope(c, fn, 's' + savepoints++ + (name ? '_' + name : ''))
      }

      function handler(q) {
        errored && q.catch(errored)
        c.state === 'full'
          ? queries.push(q)
          : c.execute(q) || (c.state = 'full', full.push(c))
      }
    }

    function onexecute(c) {
      queues[c.state].remove(c)
      c.state = 'reserved'
      c.reserved = () => queries.length
        ? c.execute(queries.shift())
        : c.state = 'reserved'
      reserved.push(c)
      connection = c
    }
  }

  function largeObject(oid, mode = 0x00020000 | 0x00040000) {
    return new Promise(async(resolve, reject) => {
      await sql.begin(async sql => {
        let finish
        !oid && ([{ oid }] = await sql`select lo_creat(-1) as oid`)
        const [{ fd }] = await sql`select lo_open(${ oid }, ${ mode }) as fd`

        const lo = {
          writable,
          readable,
          close     : () => sql`select lo_close(${ fd })`.then(finish),
          tell      : () => sql`select lo_tell64(${ fd })`,
          read      : (x) => sql`select loread(${ fd }, ${ x }) as data`,
          write     : (x) => sql`select lowrite(${ fd }, ${ x })`,
          truncate  : (x) => sql`select lo_truncate64(${ fd }, ${ x })`,
          seek      : (x, whence = 0) => sql`select lo_lseek64(${ fd }, ${ x }, ${ whence })`,
          size      : () => sql`
            select
              lo_lseek64(${ fd }, location, 0) as position,
              seek.size
            from (
              select
                lo_lseek64($1, 0, 2) as size,
                tell.location
              from (select lo_tell64($1) as location) tell
            ) seek
          `
        }

        resolve(lo)

        return new Promise(async r => finish = r)

        async function readable({
          highWaterMark = 2048 * 8,
          start = 0,
          end = Infinity
        } = {}) {
          let max = end - start
          start && await lo.seek(start)
          return new Stream.Readable({
            highWaterMark,
            async read(size) {
              const l = size > max ? size - max : size
              max -= size
              const [{ data }] = await lo.read(l)
              this.push(data)
              if (data.length < size)
                this.push(null)
            }
          })
        }

        async function writable({
          highWaterMark = 2048 * 8,
          start = 0
        } = {}) {
          start && await lo.seek(start)
          return new Stream.Writable({
            highWaterMark,
            write(chunk, encoding, callback) {
              lo.write(chunk).then(() => callback(), callback)
            }
          })
        }
      }).catch(reject)
    })
  }

  function json(x) {
    return new Parameter(x, 3802)
  }

  function array(x, type) {
    if (!Array.isArray(x))
      return array(Array.from(arguments))

    return new Parameter(x, type || (x.length ? inferType(x) || 25 : 0), options.shared.typeArrayMap)
  }

  function handler(query) {
    if (ending)
      return query.reject(Errors.connection('CONNECTION_ENDED', options, options))

    if (open.length)
      return go(open, query)

    if (closed.length)
      return connect(closed.shift(), query)

    busy.length
      ? go(busy, query)
      : queries.push(query)
  }

  function go(xs, query) {
    const c = xs.shift()
    return c.execute(query)
      ? (c.state = 'busy', busy.push(c))
      : (c.state = 'full', full.push(c))
  }

  function cancel(query) {
    return new Promise((resolve, reject) => {
      query.state
        ? query.active
          ? Connection(options, {}).cancel(query.state, resolve, reject)
          : query.cancelled = { resolve, reject }
        : (
          queries.remove(query),
          query.cancelled = true,
          query.reject(Errors.generic('57014', 'canceling statement due to user request')),
          resolve()
        )
    })
  }

  async function end({ timeout = null } = {}) {
    if (ending)
      return ending

    await 1
    let timer
    return ending = Promise.race([
      new Promise(r => timeout !== null && (timer = setTimeout(destroy, timeout * 1000, r))),
      Promise.all(connections.map(c => c.end()).concat(
        listen.sql ? listen.sql.end({ timeout: 0 }) : [],
        subscribe.sql ? subscribe.sql.end({ timeout: 0 }) : []
      ))
    ]).then(() => clearTimeout(timer))
  }

  async function destroy(resolve) {
    await Promise.all(connections.map(c => c.terminate()))
    while (queries.length)
      queries.shift().reject(Errors.connection('CONNECTION_DESTROYED', options))
    resolve()
  }

  function connect(c, query) {
    c.state = 'connecting'
    connecting.push(c)
    c.connect(query)
  }

  function onend(c) {
    queues[c.state].remove(c)
    c.state = 'ended'
    ended.push(c)
  }

  function onopen(c) {
    queues[c.state].remove(c)
    if (queries.length === 0)
      return (c.state = 'open', open.push(c))

    let max = Math.ceil(queries.length / (connecting.length + 1))
      , ready = true

    while (ready && queries.length && max-- > 0)
      ready = c.execute(queries.shift())

    ready
      ? (c.state = 'busy', busy.push(c))
      : (c.state = 'full', full.push(c))
  }

  function ondrain(c) {
    full.remove(c)
    onopen(c)
  }

  function onclose(c) {
    queues[c.state].remove(c)
    c.state = 'closed'
    c.reserved = null
    options.onclose && options.onclose(c.id)
    queries.length
      ? connect(c, queries.shift())
      : queues.closed.push(c)
  }
}

function parseOptions(a, b) {
  if (a && a.shared)
    return a

  const env = process.env // eslint-disable-line
      , o = (typeof a === 'string' ? b : a) || {}
      , { url, multihost } = parseUrl(a, env)
      , query = url.searchParams
      , host = o.hostname || o.host || multihost || url.hostname || env.PGHOST || 'localhost'
      , port = o.port || url.port || env.PGPORT || 5432
      , user = o.user || o.username || url.username || env.PGUSERNAME || env.PGUSER || osUsername()

  return Object.assign({
    host            : Array.isArray(host) ? host : host.split(',').map(x => x.split(':')[0]),
    port            : Array.isArray(port) ? port : host.split(',').map(x => parseInt(x.split(':')[1] || port)),
    path            : o.path || host.indexOf('/') > -1 && host + '/.s.PGSQL.' + port,
    database        : o.database || o.db || (url.pathname || '').slice(1) || env.PGDATABASE || user,
    user            : user,
    pass            : o.pass || o.password || url.password || env.PGPASSWORD || '',
    max             : o.max || query.get('max') || 10,
    types           : o.types || {},
    ssl             : o.ssl || parseSSL(query.get('sslmode') || query.get('ssl')) || false,
    idle_timeout    : o.idle_timeout || query.get('idle_timeout') || env.PGIDLE_TIMEOUT || warn(o.timeout),
    connect_timeout : o.connect_timeout || query.get('connect_timeout') || env.PGCONNECT_TIMEOUT || 30,
    max_lifetime    : o.max_lifetime || url.max_lifetime || max_lifetime,
    max_pipeline    : o.max_pipeline || url.max_pipeline || 100,
    backoff         : o.backoff || url.backoff || backoff,
    keep_alive      : o.keep_alive || url.keep_alive || 60,
    prepare         : 'prepare' in o ? o.prepare : 'no_prepare' in o ? !o.no_prepare : true,
    onnotice        : o.onnotice,
    onnotify        : o.onnotify,
    onclose         : o.onclose,
    onparameter     : o.onparameter,
    transform       : parseTransform(o.transform || {}),
    connection      : Object.assign({ application_name: 'postgres.js' }, o.connection),
    target_session_attrs: tsa(o, url, env),
    debug           : o.debug,
    fetch_types     : 'fetch_types' in o ? o.fetch_types : true,
    parameters      : {},
    shared          : { retries: 0, typeArrayMap: {} }
  },
    mergeUserTypes(o.types)
  )
}

function tsa(o, url, env) {
  const x = o.target_session_attrs || url.searchParams.get('target_session_attrs') || env.PGTARGETSESSIONATTRS
  if (!x || ['read-write', 'read-only', 'primary', 'standby', 'prefer-standby'].includes(x))
    return x

  throw new Error('target_session_attrs ' + x + ' is not supported')
}

function backoff(retries) {
  return (0.5 + Math.random() / 2) * Math.min(3 ** retries / 100, 20)
}

function max_lifetime() {
  return 60 * (30 + Math.random() * 30)
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
    return { url: { searchParams: new Map() } }

  let host = url
  host = host.slice(host.indexOf('://') + 3)
  host = host.split(/[?/]/)[0]
  host = host.slice(host.indexOf('@') + 1)

  return {
    url: new URL(url.replace(host, host.split(',')[0])),
    multihost: host.indexOf(',') > -1 && host
  }
}

function warn(x) {
  typeof x !== 'undefined' && console.log('The timeout option is deprecated, use idle_timeout instead') // eslint-disable-line
  return x
}

function osUsername() {
  try {
    return os.userInfo().username // eslint-disable-line
  } catch (_) {
    return process.env.USERNAME || process.env.USER || process.env.LOGNAME  // eslint-disable-line
  }
}
