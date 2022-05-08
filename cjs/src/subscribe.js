const noop = () => { /* noop */ }

module.exports = Subscribe;function Subscribe(postgres, options) {
  const subscribers = new Map()
      , slot = 'postgresjs_' + Math.random().toString(36).slice(2)
      , state = {}

  let connection
    , stream
    , ended = false

  const sql = subscribe.sql = postgres({
    ...options,
    max: 1,
    fetch_types: false,
    idle_timeout: null,
    max_lifetime: null,
    connection: {
      ...options.connection,
      replication: 'database'
    },
    onclose: async function() {
      if (ended)
        return
      stream = null
      state.pid = state.secret = undefined
      connected(await init(sql, slot, options.publications))
      subscribers.forEach(event => event.forEach(({ onsubscribe }) => onsubscribe()))
    },
    no_subscribe: true
  })

  const end = sql.end
      , close = sql.close

  sql.end = async() => {
    ended = true
    stream && (await new Promise(r => (stream.once('end', r), stream.end())))
    return end()
  }

  sql.close = async() => {
    stream && (await new Promise(r => (stream.once('end', r), stream.end())))
    return close()
  }

  return subscribe

  async function subscribe(event, fn, onsubscribe = noop) {
    event = parseEvent(event)

    if (!connection)
      connection = init(sql, slot, options.publications)

    const subscriber = { fn, onsubscribe }
    const fns = subscribers.has(event)
      ? subscribers.get(event).add(subscriber)
      : subscribers.set(event, new Set([subscriber])).get(event)

    const unsubscribe = () => {
      fns.delete(subscriber)
      fns.size === 0 && subscribers.delete(event)
    }

    return connection.then(x => {
      connected(x)
      onsubscribe()
      return { unsubscribe, state, sql }
    })
  }

  function connected(x) {
    stream = x.stream
    state.pid = x.state.pid
    state.secret = x.state.secret
  }

  async function init(sql, slot, publications) {
    if (!publications)
      throw new Error('Missing publication names')

    const xs = await sql.unsafe(
      `CREATE_REPLICATION_SLOT ${ slot } TEMPORARY LOGICAL pgoutput NOEXPORT_SNAPSHOT`
    )

    const [x] = xs

    const stream = await sql.unsafe(
      `START_REPLICATION SLOT ${ slot } LOGICAL ${
        x.consistent_point
      } (proto_version '1', publication_names '${ publications }')`
    ).writable()

    const state = {
      lsn: Buffer.concat(x.consistent_point.split('/').map(x => Buffer.from(('00000000' + x).slice(-8), 'hex')))
    }

    stream.on('data', data)
    stream.on('error', sql.close)
    stream.on('close', sql.close)

    return { stream, state: xs.state }

    function data(x) {
      if (x[0] === 0x77)
        parse(x.slice(25), state, sql.options.parsers, handle)
      else if (x[0] === 0x6b && x[17])
        pong()
    }

    function handle(a, b) {
      const path = b.relation.schema + '.' + b.relation.table
      call('*', a, b)
      call('*:' + path, a, b)
      b.relation.keys.length && call('*:' + path + '=' + b.relation.keys.map(x => a[x.name]), a, b)
      call(b.command, a, b)
      call(b.command + ':' + path, a, b)
      b.relation.keys.length && call(b.command + ':' + path + '=' + b.relation.keys.map(x => a[x.name]), a, b)
    }

    function pong() {
      const x = Buffer.alloc(34)
      x[0] = 'r'.charCodeAt(0)
      x.fill(state.lsn, 1)
      x.writeBigInt64BE(BigInt(Date.now() - Date.UTC(2000, 0, 1)) * BigInt(1000), 25)
      stream.write(x)
    }
  }

  function call(x, a, b) {
    subscribers.has(x) && subscribers.get(x).forEach(({ fn }) => fn(a, b, x))
  }
}

function Time(x) {
  return new Date(Date.UTC(2000, 0, 1) + Number(x / BigInt(1000)))
}

function parse(x, state, parsers, handle) {
  const char = (acc, [k, v]) => (acc[k.charCodeAt(0)] = v, acc)

  Object.entries({
    R: x => {  // Relation
      let i = 1
      const r = state[x.readUInt32BE(i)] = {
        schema: String(x.slice(i += 4, i = x.indexOf(0, i))) || 'pg_catalog',
        table: String(x.slice(i + 1, i = x.indexOf(0, i + 1))),
        columns: Array(x.readUInt16BE(i += 2)),
        keys: []
      }
      i += 2

      let columnIndex = 0
        , column

      while (i < x.length) {
        column = r.columns[columnIndex++] = {
          key: x[i++],
          name: String(x.slice(i, i = x.indexOf(0, i))),
          type: x.readUInt32BE(i += 1),
          parser: parsers[x.readUInt32BE(i)],
          atttypmod: x.readUInt32BE(i += 4)
        }

        column.key && r.keys.push(column)
        i += 4
      }
    },
    Y: () => { /* noop */ }, // Type
    O: () => { /* noop */ }, // Origin
    B: x => { // Begin
      state.date = Time(x.readBigInt64BE(9))
      state.lsn = x.slice(1, 9)
    },
    I: x => { // Insert
      let i = 1
      const relation = state[x.readUInt32BE(i)]
      const row = {}
      tuples(x, row, relation.columns, i += 7)

      handle(row, {
        command: 'insert',
        relation
      })
    },
    D: x => { // Delete
      let i = 1
      const relation = state[x.readUInt32BE(i)]
      i += 4
      const key = x[i] === 75
      const row = key || x[i] === 79
        ? {}
        : null

      tuples(x, row, key ? relation.keys : relation.columns, i += 3)

      handle(row, {
        command: 'delete',
        relation,
        key
      })
    },
    U: x => { // Update
      let i = 1
      const relation = state[x.readUInt32BE(i)]
      i += 4
      const key = x[i] === 75
      const old = key || x[i] === 79
        ? {}
        : null

      old && (i = tuples(x, old, key ? relation.keys : relation.columns, i += 3))

      const row = {}
      tuples(x, row, relation.columns, i + 3)

      handle(row, {
        command: 'update',
        relation,
        key,
        old
      })
    },
    T: () => { /* noop */ }, // Truncate,
    C: () => { /* noop */ }  // Commit
  }).reduce(char, {})[x[0]](x)
}

function tuples(x, row, columns, xi) {
  let type
    , column

  for (let i = 0; i < columns.length; i++) {
    type = x[xi++]
    column = columns[i]
    row[column.name] = type === 110 // n
      ? null
      : type === 117 // u
        ? undefined
        : column.parser === undefined
          ? x.toString('utf8', xi + 4, xi += 4 + x.readUInt32BE(xi))
          : column.parser.array === true
            ? column.parser(x.toString('utf8', xi + 5, xi += 4 + x.readUInt32BE(xi)))
            : column.parser(x.toString('utf8', xi + 4, xi += 4 + x.readUInt32BE(xi)))
  }

  return xi
}

function parseEvent(x) {
  const xs = x.match(/^(\*|insert|update|delete)?:?([^.]+?\.?[^=]+)?=?(.+)?/i) || []

  if (!xs)
    throw new Error('Malformed subscribe pattern: ' + x)

  const [, command, path, key] = xs

  return (command || '*')
       + (path ? ':' + (path.indexOf('.') === -1 ? 'public.' + path : path) : '')
       + (key ? '=' + key : '')
}
