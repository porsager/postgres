import { own } from './connection.js'

const noop = () => {}
    , statusInterval = 10000
    , epoch = BigInt(Date.UTC(2000, 0, 1)) * 1000n

const lsnToString = x => (x >> 32n).toString(16).toUpperCase() + '/' + (x & 0xFFFFFFFFn).toString(16).toUpperCase()

export default function Subscribe(postgres, options) {
  const subscribers = new Map()
      , persistent = !!options.slot
      , slot = options.slot || 'postgresjs_' + Math.random().toString(36).slice(2)
      , state = {}
      , timers = options.timers

  let connection
    , current = null
    , ended = false
    , retries = 0

  const sql = subscribe.sql = postgres({
    ...options,
    transform: { column: {}, value: {}, row: {} },
    max: 1,
    idle_timeout: null,
    max_lifetime: null,
    connection: {
      ...options.connection,
      replication: 'database'
    },
    onclose: () => {
      current && current.stop()
      current = null
      state.pid = state.secret = undefined
      ended || restart()
    },
    no_subscribe: true
  })

  const end = sql.end
      , close = sql.close

  sql.end = async() => {
    ended = true
    current && await current.finish()
    return end()
  }

  sql.close = async() => {
    current && await current.finish()
    return close()
  }

  return subscribe

  async function subscribe(event, fn, onsubscribe = noop, onerror) {
    event = parseEvent(event)

    connection || (connection = init())

    const subscriber = { fn, onsubscribe, onerror }
    const fns = subscribers.has(event)
      ? subscribers.get(event).add(subscriber)
      : subscribers.set(event, new Set([subscriber])).get(event)

    const unsubscribe = () => {
      fns.delete(subscriber)
      fns.size === 0 && subscribers.delete(event)
    }

    return connection.then(() => {
      onsubscribe()
      return { unsubscribe, state, sql }
    }, error => {
      unsubscribe()
      connection = null
      throw error
    })
  }

  function restart() {
    const delay = Math.min(100 * 2 ** retries++, 10000)
    connection = new Promise(r => timers.setTimeout(r, retries === 1 ? 0 : delay)).then(() => ended || init()).then(
      x => {
        retries = 0
        ended || subscribers.forEach(event => event.forEach(({ onsubscribe }) => onsubscribe()))
        return x
      },
      error => {
        report(error)
        ended || restart()
      }
    )
    connection.catch(noop)
  }

  async function init() {
    if (!options.publications)
      throw new Error('Missing publication names')

    await sql.unsafe(`CREATE_REPLICATION_SLOT ${ slot }${ persistent ? '' : ' TEMPORARY' } LOGICAL pgoutput NOEXPORT_SNAPSHOT`).catch(error => {
      if (!persistent || error.code !== '42710')
        throw error
    })

    const query = sql.unsafe(`START_REPLICATION SLOT ${ slot } LOGICAL 0/0 (proto_version '1', publication_names '${ options.publications }')`)
    query.catch(noop)
    const stream = await query.writable()
    current = Stream(stream)
    state.pid = query.state && query.state.pid
    state.secret = query.state && query.state.secret
    return current
  }

  function Stream(stream) {
    const relations = {}
    let acked = 0n
      , received = 0n
      , transaction = null
      , queue = null
      , failed = false
      , stopped = false
      , timer = timers.setTimeout(tick, statusInterval)
      , soon = null

    stream.on('data', data)
    stream.on('error', error => failed || report(error))
    stream.on('close', () => {
      const unexpected = !stopped
      stop()
      unexpected && close()
    })

    return { stop, finish }

    function data(x) {
      if (x[0] === 0x77) {
        received = max(received, x.readBigUInt64BE(9))
        parse(x.subarray(25), relations, sql.options.parsers, message, options.transform)
      } else if (x[0] === 0x6b) {
        received = max(received, x.readBigUInt64BE(1))
        idle() && (acked = max(acked, received))
        x[17] && status()
      }
    }

    function message(kind, x, info) {
      if (kind === 'begin')
        return transaction = { lsn: x.lsn, end: null, time: x.time, xid: x.xid }

      if (kind === 'commit') {
        const done = transaction
        done.end = x.end
        transaction = null
        return run(() => commit(done))
      }

      const at = transaction || {}
      info.lsn = at.lsn && lsnToString(at.lsn)
      info.time = at.time
      info.xid = at.xid
      run(() => handle(x, info))
    }

    function run(fn) {
      if (failed || stopped)
        return

      if (queue) {
        queue = queue.then(() => failed || stopped ? null : fn())
        return
      }

      const result = fn()
      if (result && typeof result.then === 'function') {
        queue = result
        stream.pause()
        drain()
      }
    }

    function drain() {
      const at = queue
      at.then(() => {
        if (queue !== at)
          return queue && drain()

        queue = null
        stopped || failed || stream.resume()
      }, noop)
    }

    function commit(done) {
      acked = max(acked, done.end)
      persistent && !soon && (soon = timers.setImmediate(() => (soon = null, status())))
    }

    function handle(row, info) {
      const path = info.relation.schema + '.' + info.relation.table
          , key = row && info.relation.keys.length ? '=' + info.relation.keys.map(x => row[x.name]) : ''
          , pending = []

      call(pending, '*', row, info)
      call(pending, '*:' + path, row, info)
      key && call(pending, '*:' + path + key, row, info)
      call(pending, info.command, row, info)
      call(pending, info.command + ':' + path, row, info)
      key && call(pending, info.command + ':' + path + key, row, info)
      return pending.length ? Promise.all(pending) : null
    }

    function call(pending, event, row, info) {
      subscribers.has(event) && subscribers.get(event).forEach(subscriber => {
        let result
        try {
          result = subscriber.fn(row, info, event)
        } catch (error) {
          return fail(error, subscriber)
        }
        result && typeof result.then === 'function' && pending.push(result.catch(error => fail(error, subscriber)))
      })
    }

    function fail(error, subscriber) {
      report(error, subscriber)
      if (!persistent || failed)
        return

      failed = true
      queue = null
      stop()
      stream.destroy(new Error('A subscriber failed, so the transaction is delivered again'))
      close()
    }

    function idle() {
      return !transaction && !queue
    }

    function tick() {
      timer = null
      if (stopped)
        return

      status()
      timer = timers.setTimeout(tick, statusInterval)
    }

    function status() {
      if (stopped || stream.destroyed || !stream.writable)
        return

      const x = Buffer.alloc(34)
      x[0] = 0x72
      x.writeBigUInt64BE(acked, 1)
      x.writeBigUInt64BE(acked, 9)
      x.writeBigUInt64BE(acked, 17)
      x.writeBigInt64BE(BigInt(Date.now()) * 1000n - epoch, 25)
      stream.write(x)
    }

    async function finish() {
      queue && await queue.catch(noop)
      if (!failed) {
        idle() && (acked = max(acked, received))
        status()
      }
      stop()
      stream.destroyed || await new Promise(r => (stream.once('close', r), stream.end()))
    }

    function stop() {
      if (stopped)
        return

      stopped = true
      timer && timers.clearTimeout(timer)
      soon && timers.clearImmediate(soon)
      timer = soon = null
    }
  }

  function report(error, subscriber) {
    const handlers = subscriber
      ? [subscriber.onerror]
      : [...subscribers.values()].flatMap(x => [...x].map(x => x.onerror))

    const listeners = handlers.filter(Boolean)
    listeners.length
      ? listeners.forEach(fn => fn(error))
      : console.error('postgres.js: logical replication error', error)
  }
}

function max(a, b) {
  return a > b ? a : b
}

function Time(x) {
  return new Date(Date.UTC(2000, 0, 1) + Number(x / 1000n))
}

function parse(x, relations, parsers, message, transform) {
  const type = x[0]
  if (type === 82) {
    let i = 1
    const r = relations[x.readUInt32BE(i)] = {
      schema: x.toString('utf8', i += 4, i = x.indexOf(0, i)) || 'pg_catalog',
      table: x.toString('utf8', i + 1, i = x.indexOf(0, i + 1)),
      columns: Array(x.readUInt16BE(i += 2)),
      keys: []
    }
    i += 2

    let columnIndex = 0
      , column

    while (i < x.length) {
      column = r.columns[columnIndex++] = {
        key: x[i++],
        name: transform.column.from
          ? transform.column.from(x.toString('utf8', i, i = x.indexOf(0, i)))
          : x.toString('utf8', i, i = x.indexOf(0, i)),
        type: x.readUInt32BE(i += 1),
        parser: parsers[x.readUInt32BE(i)],
        atttypmod: x.readUInt32BE(i += 4)
      }

      column.key && r.keys.push(column)
      i += 4
    }
  } else if (type === 66) {
    message('begin', { lsn: x.readBigUInt64BE(1), time: Time(x.readBigInt64BE(9)), xid: x.readUInt32BE(17) })
  } else if (type === 67) {
    message('commit', { lsn: x.readBigUInt64BE(2), end: x.readBigUInt64BE(10) })
  } else if (type === 73) {
    const relation = relations[x.readUInt32BE(1)]
    message('change', tuples(x, relation.columns, 8, transform).row, { command: 'insert', relation })
  } else if (type === 68) {
    let i = 1
    const relation = relations[x.readUInt32BE(i)]
    i += 4
    const key = x[i] === 75
    message('change', key || x[i] === 79
      ? tuples(x, relation.columns, i += 3, transform).row
      : null
    , { command: 'delete', relation, key })
  } else if (type === 85) {
    let i = 1
    const relation = relations[x.readUInt32BE(i)]
    i += 4
    const key = x[i] === 75
    const xs = key || x[i] === 79
      ? tuples(x, relation.columns, i += 3, transform)
      : null

    xs && (i = xs.i)

    const { row } = tuples(x, relation.columns, i + 3, transform)
    message('change', row, { command: 'update', relation, key, old: xs && xs.row })
  } else if (type === 84) {
    const count = x.readUInt32BE(1)
        , flags = x[5]
    for (let i = 0; i < count; i++) {
      message('change', null, {
        command: 'truncate',
        relation: relations[x.readUInt32BE(6 + i * 4)],
        cascade: (flags & 1) === 1,
        restartIdentity: (flags & 2) === 2
      })
    }
  }
}

function tuples(x, columns, xi, transform) {
  let type
    , column
    , value

  const row = {}
  for (let i = 0; i < columns.length; i++) {
    type = x[xi++]
    column = columns[i]
    value = type === 110
      ? null
      : type === 117
        ? undefined
        : column.parser(x.toString('utf8', xi + 4, xi += 4 + x.readUInt32BE(xi)))

    value = transform.value.from ? transform.value.from(value, column) : value
    column.name === '__proto__' ? own(row, column.name, value) : row[column.name] = value
  }

  return { i: xi, row: transform.row.from ? transform.row.from(row) : row }
}

function parseEvent(x) {
  const [, command, path, key] = x.match(/^(\*|insert|update|delete|truncate)?:?([^.]+?\.?[^=]+)?=?(.+)?/i)

  return (command || '*')
       + (path ? ':' + (path.indexOf('.') === -1 ? 'public.' + path : path) : '')
       + (key ? '=' + key : '')
}
