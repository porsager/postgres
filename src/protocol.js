class Out {
  constructor(size) {
    this.size = size
    this.b = Buffer.allocUnsafe(size)
    this.length = 0
    this.at = 0
  }

  type(x) {
    this.fit(5)
    const i = this.at = this.length
    this.b[i] = x
    this.length = i + 5
    return this
  }

  untyped() {
    this.fit(4)
    this.at = this.length
    this.length += 4
    return this
  }

  end() {
    this.b.writeInt32BE(this.length - this.at - 1, this.at + 1)
    return this
  }

  endUntyped() {
    this.b.writeInt32BE(this.length - this.at, this.at)
    return this
  }

  str(x) {
    this.fit(x.length * 3 + 1)
    const i = this.length + this.b.write(x, this.length)
    this.b[i] = 0
    this.length = i + 1
    return this
  }

  bytes(x) {
    if (typeof x === 'string') {
      this.fit(x.length * 3)
      this.length += this.b.write(x, this.length)
    } else {
      this.fit(x.length)
      this.b.set(x, this.length)
      this.length += x.length
    }
    return this
  }

  value(x) {
    if (x === null || x === undefined)
      return this.i32(-1)
    const n = this.length
    this.length = n + 4
    this.bytes(x)
    this.b.writeInt32BE(this.length - n - 4, n)
    return this
  }

  u8(x) {
    this.fit(1)
    this.b[this.length++] = x
    return this
  }

  i16(x) {
    this.fit(2)
    this.b.writeInt16BE(x, this.length)
    this.length += 2
    return this
  }

  u16(x) {
    this.fit(2)
    this.b.writeUInt16BE(x, this.length)
    this.length += 2
    return this
  }

  i32(x) {
    this.fit(4)
    this.b.writeInt32BE(x, this.length)
    this.length += 4
    return this
  }

  truncate(n) {
    this.length = n
    return this
  }

  take() {
    const i = this.length
        , out = i < 4096 ? Buffer.from(this.b.subarray(0, i)) : this.b.subarray(0, i)
    i >= 4096 && (this.b = Buffer.allocUnsafe(this.size))
    this.length = this.at = 0
    return out
  }

  fit(n) {
    if (this.b.length - this.length >= n)
      return

    const prev = this.b
    this.b = Buffer.allocUnsafe(Math.max(this.size, prev.length * 2, this.length + n))
    prev.copy(this.b, 0, 0, this.length)
  }
}

export function Writer(size = 16384) {
  return new Out(size)
}

const own = Writer(1024)

const S = 83
    , H = 72
    , X = 88
    , c = 99
    , Q = 81
    , p = 112
    , d = 100
    , f = 102
    , D = 68
    , C = 67
    , E = 69
    , P = 80
    , B = 66

export const sync = w => w.type(S).end()
export const flush = w => w.type(H).end()
export const terminate = w => w.type(X).end()
export const copyDone = w => w.type(c).end()
export const sslRequest = w => w.untyped().i32(80877103).endUntyped()
export const query = (w, text) => w.type(Q).str(text).end()
export const password = (w, x) => w.type(p).str(x).end()
export const saslResponse = (w, x) => w.type(p).bytes(x).end()
export const copyData = (w, x) => w.type(d).bytes(x).end()
export const copyFail = (w, x) => w.type(f).str(x).end()
export const describe = (w, kind, name) => w.type(D).u8(kind.charCodeAt(0)).str(name).end()
export const close = (w, kind, name) => w.type(C).u8(kind.charCodeAt(0)).str(name).end()
export const execute = (w, portal, rows = 0) => w.type(E).str(portal).i32(rows).end()
export const cancel = (w, pid, secret) => w.untyped().i32(80877102).i32(pid).i32(secret).endUntyped()

export const Sync = one(sync)
export const Flush = one(flush)
export const Terminate = one(terminate)
export const CopyDone = one(copyDone)
export const SSLRequest = one(sslRequest)
export const Query = one(query)
export const Password = one(password)
export const SASLResponse = one(saslResponse)
export const CopyData = one(copyData)
export const CopyFail = one(copyFail)
export const Describe = one(describe)
export const Close = one(close)
export const Execute = one(execute)
export const Cancel = one(cancel)
export const Startup = one(startup)
export const SASL = one(sasl)
export const Parse = one(parse)
export const Bind = one(bind)
export const Run = one(run)

function one(fn) {
  return (...xs) => {
    try {
      fn(own, ...xs)
    } catch (error) {
      own.truncate(0)
      throw error
    }
    return own.take()
  }
}

export function startup(w, parameters) {
  w.untyped().i32(196608)
  for (const k in parameters)
    parameters[k] && w.str(unbroken(k, k)).str(unbroken(k, '' + parameters[k]))

  return w.u8(0).endUntyped()
}

function unbroken(k, x) {
  if (x.indexOf('\0') !== -1)
    throw Object.assign(new Error('The connection parameter ' + k + ' contains a NUL character'), { code: 'NUL_CHARACTER' })

  return x
}

export function sasl(w, mechanism, initial) {
  return w.type(p).str(mechanism).i32(Buffer.byteLength(initial)).bytes(initial).end()
}

export function parse(w, name, text, oids = []) {
  w.type(P).str(name).str(text).u16(oids.length)
  for (let j = 0; j < oids.length; j++)
    w.i32(oids[j] | 0)

  return w.end()
}

export function bind(w, portal, name, values = [], formats = [], resultFormats = []) {
  w.type(B).str(portal).str(name).i16(formats.length)
  for (let j = 0; j < formats.length; j++)
    w.i16(formats[j])

  w.u16(values.length)
  for (let j = 0; j < values.length; j++)
    w.value(values[j])

  w.i16(resultFormats.length)
  for (let j = 0; j < resultFormats.length; j++)
    w.i16(resultFormats[j])

  return w.end()
}

export function run(w, portal, name, values, rows, flushing, formats) {
  bind(w, portal, name, values, undefined, formats || undefined)
  execute(w, portal, rows)
  return flushing ? flush(w) : sync(w)
}

const largest = 0x40000000

export function Frames(onframe, shared = false, onerror = null) {
  const chunks = []
      , owned = new WeakSet()

  let data = null
    , owning = false
    , at = 0
    , part = null
    , filled = 0
    , paused = false
    , running = false
    , broken = false

  return {
    push(x) {
      if (broken)
        return

      chunks.push(shared && (paused || owning) ? own(x) : x)
      run()
    },
    paused() {
      return paused
    },
    owns(x) {
      return !shared || owned.has(x)
    },
    own(x) {
      owning = x
      x && settle()
    },
    pause() {
      paused = true
      settle()
    },
    resume() {
      paused = false
      run()
    }
  }

  function own(x) {
    const copy = Buffer.from(x)
    owned.add(copy)
    return copy
  }

  function settle() {
    if (!shared)
      return

    data && at < data.length && !owned.has(data) && (data = own(data.subarray(at)), at = 0)
    for (let i = 0; i < chunks.length; i++)
      owned.has(chunks[i]) || (chunks[i] = own(chunks[i]))
  }

  function run() {
    if (running)
      return

    running = true
    try {
      while (true) {
        if (broken || paused || !(data && at < data.length || next()))
          break
        part ? fill() : frame()
      }
    } finally {
      running = false
    }
  }

  function invalid(length) {
    if (length >= 4 && length <= largest)
      return false

    broken = true
    chunks.length = 0
    data = part = null
    at = filled = 0
    const error = Object.assign(new Error('The server sent a message with an invalid length (' + length + ')'), { code: 'PROTOCOL_ERROR' })
    onerror && onerror(error)
    return true
  }

  function next() {
    data = chunks.shift() || null
    at = 0
    return data !== null
  }

  function frame() {
    const left = data.length - at
    if (left < 5)
      return start(5)

    const length = data.readInt32BE(at + 1)
    if (invalid(length))
      return

    const end = at + 1 + length
    if (end > data.length)
      return start(end - at)

    const begin = at
    at = end
    onframe(data[begin], data, begin, end)
  }

  function start(length) {
    part = Buffer.allocUnsafe(length)
    shared && owned.add(part)
    filled = data.copy(part, 0, at)
    at = data.length
  }

  function fill() {
    const n = data.copy(part, filled, at, at + part.length - filled)
    filled += n
    at += n
    if (filled < part.length)
      return

    if (part.length === 5) {
      const head = part
          , length = head.readInt32BE(1)
      if (invalid(length))
        return

      part = Buffer.allocUnsafe(1 + length)
      shared && owned.add(part)
      filled = head.copy(part)
      return filled === part.length && done()
    }
    done()
  }

  function done() {
    const x = part
    part = null
    onframe(x[0], x, 0, x.length)
  }
}

const errorFields = {
  83: 'severity_local',
  86: 'severity',
  67: 'code',
  77: 'message',
  68: 'detail',
  72: 'hint',
  80: 'position',
  112: 'internal_position',
  113: 'internal_query',
  87: 'where',
  115: 'schema_name',
  116: 'table_name',
  99: 'column_name',
  100: 'data_type_name',
  110: 'constraint_name',
  70: 'file',
  76: 'line',
  82: 'routine'
}

export function error(x, start, end) {
  const fields = {}
  for (let i = start + 5; i < end - 1;) {
    const zero = x.indexOf(0, i + 1)
    fields[errorFields[x[i]] || String.fromCharCode(x[i])] = x.toString('utf8', i + 1, zero)
    i = zero + 1
  }

  fields.severity || (fields.severity = fields.severity_local)
  return fields
}

export const text = typeof Buffer.prototype.utf8Slice === 'function'
  ? (x, start, end) => x.utf8Slice(start, end)
  : (x, start, end) => x.toString('utf8', start, end)

const u32 = (x, i) => ((x[i] << 24) | (x[i + 1] << 16) | (x[i + 2] << 8) | x[i + 3]) >>> 0
    , u16 = (x, i) => (x[i] << 8) | x[i + 1]
    , field = (name, table, number, type) => ({ name, table, number, type })

export function rowDescription(x, start, end, make = field) {
  const columns = new Array((x[start + 5] << 8) | x[start + 6])
  for (let i = start + 7, j = 0; j < columns.length; j++) {
    let zero = i
    while (x[zero] !== 0)
      zero++
    columns[j] = make(text(x, i, zero), u32(x, zero + 1), u16(x, zero + 5), u32(x, zero + 7))
    i = zero + 19
  }
  return columns
}

export function parameterDescription(x, start) {
  const oids = new Array(x.readUInt16BE(start + 5))
  for (let j = 0; j < oids.length; j++)
    oids[j] = x.readUInt32BE(start + 7 + j * 4)

  return oids
}

function digits(x, start, end) {
  let n = 0
  for (let i = start; i < end; i++)
    n = n * 10 + x[i] - 48
  return n
}

function word(x, start, end) {
  if (end - start !== 6 || x[start + 2] !== 76 && x[start + 2] !== 83 && x[start + 2] !== 68)
    return text(x, start, end)

  const a = x[start]
      , b = x[start + 1]
      , c = x[start + 2]
      , d = x[start + 3]
      , e = x[start + 4]
      , f = x[start + 5]
  return a === 83 && b === 69 && c === 76 && d === 69 && e === 67 && f === 84 ? 'SELECT'
    : a === 73 && b === 78 && c === 83 && d === 69 && e === 82 && f === 84 ? 'INSERT'
    : a === 85 && b === 80 && c === 68 && d === 65 && e === 84 && f === 69 ? 'UPDATE'
    : a === 68 && b === 69 && c === 76 && d === 69 && e === 84 && f === 69 ? 'DELETE'
    : text(x, start, end)
}

export function commandComplete(x, start, end) {
  const first = start + 5

  let e = end - 1
    , count = null

  while (true) {
    let s = e - 1
    while (s >= first && x[s] >= 48 && x[s] <= 57)
      s--
    if (s === e - 1 || s < first || x[s] !== 32)
      break
    count === null && (count = e - s > 16 ? +text(x, s + 1, e) : digits(x, s + 1, e))
    e = s
  }

  return { command: word(x, first, e), count }
}

export function readyForQuery(x, start) {
  return String.fromCharCode(x[start + 5])
}

export function notification(x, start) {
  const zero = x.indexOf(0, start + 9)
  return {
    pid: x.readInt32BE(start + 5),
    channel: x.toString('utf8', start + 9, zero),
    payload: x.toString('utf8', zero + 1, x.indexOf(0, zero + 1))
  }
}

export function parameterStatus(x, start) {
  const zero = x.indexOf(0, start + 5)
  return [x.toString('utf8', start + 5, zero), x.toString('utf8', zero + 1, x.indexOf(0, zero + 1))]
}

export function backendKeyData(x, start) {
  return { pid: x.readInt32BE(start + 5), secret: x.readInt32BE(start + 9) }
}
