export default function Subscribe(postgres, options) {
  const listeners = new Map()

  let connection

  return async function subscribe(event, fn) {
    event = parseEvent(event)

    options.max = 1
    options.onclose = onclose
    options.connection = {
      ...options.connection,
      replication: 'database'
    }

    let stream
      , ended = false

    const sql = postgres(options)
        , slot = 'postgresjs_' + Math.random().toString(36).slice(2)
        , end = sql.end

    sql.end = async() => {
      ended = true
      stream && (await new Promise(r => (stream.once('end', r), stream.end())))
      return end()
    }

    !connection && (subscribe.sql = sql, connection = init(sql, slot, options.publications))

    const fns = listeners.has(event)
      ? listeners.get(event).add(fn)
      : listeners.set(event, new Set([fn]))

    const unsubscribe = () => {
      fns.delete(fn)
      fns.size === 0 && listeners.delete(event)
    }

    return connection.then(x => (stream = x, { unsubscribe }))

    async function onclose() {
      stream = null
      !ended && (stream = await init(sql, slot, options.publications))
    }
  }

  async function init(sql, slot, publications = 'alltables') {
    if (!publications)
      throw new Error('Missing publication names')

    const [x] = await sql.unsafe(
      `CREATE_REPLICATION_SLOT ${ slot } TEMPORARY LOGICAL pgoutput NOEXPORT_SNAPSHOT`
    )

    const stream = await sql.unsafe(
      `START_REPLICATION SLOT ${ slot } LOGICAL ${
        x.consistent_point
      } (proto_version '1', publication_names '${ publications }')`
    ).writable()

    const state = {
      lsn: Buffer.concat(x.consistent_point.split('/').map(x => Buffer.from(('00000000' + x).slice(-8), 'hex')))
    }

    stream.on('data', data)
    stream.on('error', (error) => {
      console.error('Logical Replication Error - Reconnecting', error)
      sql.end()
    })

    return stream

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
    listeners.has(x) && listeners.get(x).forEach(fn => fn(a, b, x))
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

      old && (i = tuples(x, old, key ? relation.keys : relation.columns, ++i))

      const row = {}
      i = tuples(x, row, relation.columns, i += 3)

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
