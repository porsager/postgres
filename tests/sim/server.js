import { Pipe } from './net.js'

const select = /^select (\S+) as id, (\S+) as scope(?: from rows\((\S+)\))?(?: fail\((\S+)\))?(?: sleep\((\S+)\))?$/i
    , control = /^(begin|commit|end|rollback|savepoint \w+|release savepoint \w+|rollback to savepoint \w+)\b/i

export function Server({ clock, random, delay, split, hosts = 1, log = null }) {
  const { setTimeout } = clock.timers
      , sessions = new Set()
      , violations = []
      , attempts = []
      , scopes = new Map()
      , outcomes = new Map()
      , stale = new Map()
      , latest = new Map()
      , startup = [...Array(hosts)].map(() => 'ready')
  let pids = 1000
    , peak = 0

  return {
    sessions,
    violations,
    attempts,
    outcomes,
    startup,
    get peak() { return peak },
    socket,
    kill: x => x.fatal('57P01', 'terminating connection due to administrator command'),
    close: (x, reset) => reset ? x.end.destroy() : x.end.end(),
    stale: x => x.prepared.forEach(p => p.stale = true),
    deallocate: x => (x.prepared.forEach((p, name) => x.wiped.add(name)), x.prepared.clear()),
    retype: x => x.shape = x.shape === 'a' ? 'b' : 'a',
    commitRollback: x => x.commitRollback = true
  }

  function socket(host = 0) {
    const { client, server } = Pipe({ clock, random, delay, split })
    Session(server, host)
    return client
  }

  function violation(x) {
    violations.push(x)
  }

  function Session(end, host) {
    const prepared = new Map()
        , portals = new Map()
        , queue = []
    let incoming = Buffer.alloc(0)
      , started = false
      , busy = false
      , discard = false
      , status = 'I'
      , txScope = 0
      , txScopes = new Set()
      , sleeping = null
      , gone = false

    const x = {
      id: ++pids,
      secret: random.int(1, 1e9),
      end,
      prepared,
      wiped: new Set(),
      shape: 'a',
      commitRollback: false,
      get status() { return status },
      fatal
    }

    end.on('data', data => {
      incoming = Buffer.concat([incoming, data])
      while (incoming.length >= (started ? 5 : 4)) {
        const length = started ? incoming.readInt32BE(1) + 1 : incoming.readInt32BE(0)
        if (incoming.length < length)
          break

        const message = incoming.subarray(0, length)
        incoming = incoming.subarray(length)
        started ? (queue.push(message), pump()) : first(message)
      }
    })
    end.on('close', () => {
      gone = true
      status !== 'I' && txScopes.forEach(s => outcomes.set(s, 'rollback'))
      sessions.delete(x)
      sleeping && sleeping.cancel()
    })
    end.on('error', () => {})

    return x

    function first(message) {
      const code = message.readInt32BE(4)
      if (code === 80877103)
        return end.write('N')

      if (code === 80877102) {
        const pid = message.readInt32BE(8)
            , secret = message.readInt32BE(12)
        for (const s of sessions)
          s.id === pid && s.secret === secret && s.cancel && s.cancel()
        return end.end()
      }
      started = true
      const mode = startup[host]
      mode !== 'ready' && attempts.push(clock.now)
      if (mode === 'close')
        return end.end()

      if (mode === 'error')
        return end.end(error('FATAL', '53300', 'sorry, too many clients already'))

      if (mode === 'hang')
        return

      sessions.add(x)
      peak = Math.max(peak, [...sessions].filter(x => x.end.writable).length)
      x.cancel = () => sleeping && sleeping.cancel(true)
      end.write(Buffer.concat([
        msg('R', i32(0)),
        ...Object.entries({
          server_version: '16.0',
          client_encoding: 'UTF8',
          DateStyle: 'ISO, MDY',
          TimeZone: 'UTC',
          integer_datetimes: 'on',
          standard_conforming_strings: 'on'
        }).map(([k, v]) => msg('S', str(k), str(v))),
        msg('K', i32(x.id), i32(x.secret)),
        ready()
      ]))
    }

    function fatal(code, message) {
      gone || end.end(error('FATAL', code, message))
    }

    function pump() {
      while (true) {
        if (busy || gone || !queue.length)
          break
        handle(queue.shift())
      }
    }

    function handle(m) {
      const type = String.fromCharCode(m[0])
          , r = reader(m, 5)

      log && log(x.id + ' ' + status + (discard ? ' discard ' : ' ') + type + ' ' + m.subarray(5).toString().replace(/[^ -~]+/g, '.').slice(0, 90))
      if (discard && type !== 'S')
        return

      if (type === 'P') {
        const name = r.str()
            , text = r.str()
        const ast = parse(text)
        if (!ast)
          return fail('42601', 'syntax error at or near "' + text.slice(0, 10) + '"')

        if (status === 'E' && !ast.control)
          return fail('25P02', 'current transaction is aborted, commands ignored until end of transaction block')

        if (name && prepared.has(name)) {
          violation('parse of statement "' + name + '" that already exists in session ' + x.id)
          return fail('42P05', 'prepared statement "' + name + '" already exists')
        }
        prepared.set(name, { text, ast, stale: false, shape: x.shape })
        x.wiped.delete(name)
        reply(msg('1'))
      } else if (type === 'B') {
        const portal = r.str()
            , name = r.str()
            , formats = r.i16s()
            , n = r.i16()
            , values = [...Array(n)].map(() => r.bytes())
        formats
        const p = prepared.get(name)
        if (!p) {
          name && !x.wiped.has(name) && violation('bind of statement "' + name + '" that session ' + x.id + ' never had')
          return fail('26000', 'prepared statement "' + name + '" does not exist')
        }
        portals.set(portal, { p, values: values.map(x => x === null ? null : x.toString()), row: 0 })
        reply(msg('2'))
      } else if (type === 'D') {
        const kind = r.byte()
            , name = r.str()
        const p = kind === 'S' ? prepared.get(name) : portals.get(name) && portals.get(name).p
        if (!p) {
          kind === 'S' && name && !x.wiped.has(name) && violation('describe of statement "' + name + '" that session ' + x.id + ' never had')
          return fail(kind === 'S' ? '26000' : '34000', 'does not exist')
        }
        if (p.ast.select && p.shape !== x.shape)
          return fail('0A000', 'cached plan must not change result type')

        kind === 'S' && reply(msg('t', i16(p.ast.params), ...[...Array(p.ast.params)].map(() => i32(23))))
        reply(p.ast.select ? columns(x.shape) : msg('n'))
      } else if (type === 'E') {
        const name = r.str()
            , limit = r.i32()
        const portal = portals.get(name)
        if (!portal) {
          violation('execute of portal "' + name + '" that does not exist in session ' + x.id)
          return fail('34000', 'portal "' + name + '" does not exist')
        }
        execute(portal, limit, false)
      } else if (type === 'Q') {
        const text = r.str()
        const ast = parse(text)
        if (!ast) {
          fail('42601', 'syntax error')
          discard = false
          return reply(ready())
        }
        execute({ p: { text, ast, shape: x.shape }, values: [], row: 0 }, 0, true)
      } else if (type === 'S') {
        discard = false
        status === 'I' && portals.clear()
        reply(ready())
      } else if (type === 'C') {
        r.byte() === 'S' ? prepared.delete(r.str()) : portals.delete(r.str())
        reply(msg('3'))
      } else if (type === 'X') {
        end.end()
      } else if (type !== 'H') {
        fail('08P01', 'unsupported message ' + type)
      }
    }

    function execute(portal, limit, simple) {
      const { ast } = portal.p
          , value = v => v === null ? null : v[0] === '$' ? +portal.values[+v.slice(1) - 1] : +v
          , done = () => simple && (discard = false, reply(ready()))

      if (ast.control)
        return transaction(ast.control) || done()

      const id = value(ast.id)
          , scope = value(ast.scope)
          , rows = ast.rows ? value(ast.rows) : 1
          , at = ast.fail === null ? -1 : value(ast.fail)
          , ms = ast.sleep === null ? 0 : value(ast.sleep)

      bind(scope)
      check(id, scope)
      portal.ordered || order(id, scope)
      portal.ordered = true

      if (portal.p.stale || (ast.select && portal.p.shape !== x.shape)) {
        stale.has(id) || stale.set(id, { status, retries: 0 })
        fail('0A000', 'cached plan must not change result type')
        return done()
      }

      if (status === 'E') {
        fail('25P02', 'current transaction is aborted, commands ignored until end of transaction block')
        return done()
      }

      if (ms && !portal.slept) {
        busy = true
        let timer = null
        sleeping = {
          cancel: cancelled => {
            clock.timers.clearTimeout(timer)
            sleeping = null
            busy = false
            if (cancelled) {
              fail('57014', 'canceling statement due to user request')
              done()
              pump()
            }
          }
        }
        timer = setTimeout(() => {
          sleeping = null
          busy = false
          portal.slept = true
          execute(portal, limit, simple)
          pump()
        }, ms)
        return
      }

      simple && reply(columns(x.shape))
      const out = []
      while (portal.row < rows) {
        if (portal.row === at) {
          reply(Buffer.concat(out))
          fail('22012', 'division by zero')
          return done()
        }
        if (limit && out.length === limit) {
          reply(Buffer.concat([...out, msg('s')]))
          return
        }
        out.push(msg('D', i16(3), ...cell(id), ...cell(scope), ...cell(x.shape === 'a' ? 1 : 'b')))
        portal.row++
      }
      reply(Buffer.concat([...out, msg('C', str('SELECT ' + out.length))]))
      done()
    }

    function check(id, scope) {
      const retry = stale.get(id)
      if (retry && ++retry.retries) {
        retry.status !== 'I' && violation('stale plan for query ' + id + ' retried while the session was ' + retry.status)
        retry.retries > 1 && violation('stale plan for query ' + id + ' retried ' + retry.retries + ' times')
      }

      if (scope && scopes.has(scope) && scopes.get(scope) !== x.id)
        violation('scope ' + scope + ' reached session ' + x.id + ' after session ' + scopes.get(scope))
      scope && scopes.set(scope, x.id)

      if (status !== 'I' && scope !== txScope)
        violation('query ' + id + ' of scope ' + scope + ' reached session ' + x.id + ' inside the transaction of scope ' + txScope)
    }

    function order(id, scope) {
      if (!scope)
        return

      latest.get(scope) > id && violation('query ' + id + ' of scope ' + scope + ' reached the server after query ' + latest.get(scope))
      latest.set(scope, Math.max(id, latest.get(scope) || 0))
    }

    function transaction(command) {
      const c = command.toLowerCase()
      if (c === 'begin') {
        status === 'I' && (txScope = -1, txScopes = new Set())
        status = status === 'I' ? 'T' : status
        reply(msg('C', str('BEGIN')))
      } else if (c === 'commit' || c === 'end') {
        const rolled = status === 'E' || x.commitRollback
        x.commitRollback = false
        txScopes.forEach(s => outcomes.set(s, rolled ? 'rollback' : 'commit'))
        status = 'I'
        txScope = 0
        portals.clear()
        reply(msg('C', str(rolled ? 'ROLLBACK' : 'COMMIT')))
      } else if (c === 'rollback') {
        txScopes.forEach(s => outcomes.set(s, 'rollback'))
        status = 'I'
        txScope = 0
        portals.clear()
        reply(msg('C', str('ROLLBACK')))
      } else if (c.startsWith('rollback to')) {
        status === 'I' ? fail('25P01', 'no transaction') : (status = 'T', reply(msg('C', str('ROLLBACK'))))
      } else {
        status === 'I'
          ? fail('25P01', 'SAVEPOINT can only be used in transaction blocks')
          : status === 'E'
            ? fail('25P02', 'current transaction is aborted')
            : reply(msg('C', str(c.startsWith('release') ? 'RELEASE' : 'SAVEPOINT')))
      }
    }

    function bind(scope) {
      txScope === -1 && scope && (txScope = scope, txScopes.add(scope))
    }

    function fail(code, message) {
      status === 'T' && (status = 'E')
      discard = true
      reply(error('ERROR', code, message))
    }

    function reply(x) {
      gone || end.write(x)
    }

    function ready() {
      return msg('Z', Buffer.from(status))
    }

    function parse(text) {
      const c = text.trim().match(control)
      if (c)
        return { control: c[1], params: 0, select: false }

      const m = text.trim().match(select)
      if (!m)
        return null

      const [, id, scope, rows = null, fail = null, sleep = null] = m.map(x => x && x.replace(/::int$/, ''))
      const params = Math.max(0, ...[id, scope, rows, fail, sleep].filter(x => x && x[0] === '$').map(x => +x.slice(1)))
      return { select: true, params, id, scope, rows, fail, sleep }
    }
  }
}

function columns(shape) {
  const column = (name, type) => Buffer.concat([str(name), i32(0), i16(0), i32(type), i16(4), i32(-1), i16(0)])
  return msg('T', i16(3), column('id', 23), column('scope', 23), column('shape', shape === 'a' ? 23 : 25))
}

function cell(x) {
  if (x === null || x === undefined)
    return [i32(-1)]

  const b = Buffer.from(String(x))
  return [i32(b.length), b]
}

function error(severity, code, message) {
  return msg('E', Buffer.from('S' + severity + '\0V' + severity + '\0C' + code + '\0M' + message + '\0\0'))
}

function reader(b, i) {
  return {
    byte: () => String.fromCharCode(b[i++]),
    i16: () => (i += 2, b.readInt16BE(i - 2)),
    i32: () => (i += 4, b.readInt32BE(i - 4)),
    i16s() { return [...Array(this.i16())].map(() => this.i16()) },
    str: () => {
      const end = b.indexOf(0, i)
      const x = b.toString('utf8', i, end)
      i = end + 1
      return x
    },
    bytes() {
      const n = this.i32()
      return n === -1 ? null : (i += n, b.subarray(i - n, i))
    }
  }
}

function str(x) { return Buffer.from(x + '\0') }
function i16(x) { const b = Buffer.alloc(2); b.writeInt16BE(x); return b }
function i32(x) { const b = Buffer.alloc(4); b.writeInt32BE(x); return b }
function msg(type, ...parts) {
  const body = Buffer.concat(parts)
  return Buffer.concat([Buffer.from(type), i32(body.length + 4), body])
}
