const char = module.exports.char = (acc, [k, v]) => (acc[k.charCodeAt(0)] = v, acc)
const entries = o => Object.keys(o).map(x => [x, o[x]])

// These were the fastest ways to do it in Node.js v12.11.1 (add tests to revise if this changes)
const types = module.exports.types = {
  string: {
    to: 25,
    from: null,             // defaults to string
    serialize: x => '' + x
  },
  number: {
    to: 0,
    from: [21, 23, 26, 700, 701],
    serialize: x => '' + x,
    parse: x => +x
  },
  json: {
    to: 3802,
    from: [114, 3802],
    serialize: x => JSON.stringify(x),
    parse: x => JSON.parse(x)
  },
  boolean: {
    to: 16,
    from: 16,
    serialize: x => x === true ? 't' : 'f',
    parse: x => x === 't'
  },
  date: {
    to: 1184,
    from: [1082, 1083, 1114, 1184],
    serialize: x => x.toISOString(),
    parse: x => new Date(x)
  },
  bytea: {
    to: 17,
    from: 17,
    serialize: x => '\\x' + x.toString('hex'),
    parse: x => Buffer.from(x.slice(2), 'hex')
  }
}

const defaultHandlers = typeHandlers(types)

const serializers = module.exports.serializers = defaultHandlers.serializers
const parsers = module.exports.parsers = defaultHandlers.parsers

module.exports.entries = entries

module.exports.END = {}

module.exports.mergeUserTypes = function(types) {
  const user = typeHandlers(types || {})
  return {
    serializers: Object.assign({}, serializers, user.serializers),
    parsers: Object.assign({}, parsers, user.parsers)
  }
}

function typeHandlers(types) {
  return Object.keys(types).reduce((acc, k) => {
    types[k].from && [].concat(types[k].from).forEach(x => acc.parsers[x] = types[k].parse)
    acc.serializers[types[k].to] = types[k].serialize
    return acc
  }, { parsers: {}, serializers: {} })
}

module.exports.escape = function escape(str) {
  return '"' + str.replace(/"/g, '""') + '"'
}

const type = {
  number: 0,
  bigint: 20,
  boolean: 16
}

module.exports.inferType = function inferType(x) {
  return (x && x.type) || (x instanceof Date
    ? 1184
    : Array.isArray(x)
      ? inferType(x[0])
      : x instanceof Buffer
        ? 17
        : type[typeof x] || 0)
}

const escapeBackslash = /\\/g
const escapeQuote = /"/g

function arrayEscape(x) {
  return x
    .replace(escapeBackslash, '\\\\')
    .replace(escapeQuote, '\\"')
}

module.exports.arraySerializer = function arraySerializer(xs, serializer) {
  if (!xs.length)
    return '{}'

  const first = xs[0]

  if (Array.isArray(first) && !first.type)
    return '{' + xs.map(x => arraySerializer(x, serializer)).join(',') + '}'

  return '{' + xs.map(x =>
    '"' + arrayEscape(serializer ? serializer(x.type ? x.value : x) : '' + x) + '"'
  ).join(',') + '}'
}

const arrayParserState = {
  i: 0,
  char: null,
  str: '',
  quoted: false,
  last: 0
}

module.exports.arrayParser = function arrayParser(x, parser) {
  arrayParserState.i = arrayParserState.last = 0
  return arrayParserLoop(arrayParserState, x, parser)
}

function arrayParserLoop(s, x, parser) {
  const xs = []
  for (; s.i < x.length; s.i++) {
    s.char = x[s.i]
    if (s.quoted) {
      if (s.char === '\\') {
        s.str += x[++s.i]
      } else if (s.char === '"') {
        xs.push(parser ? parser(s.str) : s.str)
        s.str = ''
        s.quoted = x[s.i + 1] === '"'
        s.last = s.i + 2
      } else {
        s.str += s.char
      }
    } else if (s.char === '"') {
      s.quoted = true
    } else if (s.char === '{') {
      s.last = ++s.i
      xs.push(arrayParserLoop(s, x, parser))
    } else if (s.char === '}') {
      s.quoted = false
      s.last < s.i && xs.push(parser ? parser(x.slice(s.last, s.i)) : x.slice(s.last, s.i))
      s.last = s.i + 1
      break
    } else if (s.char === ',' && s.p !== '}' && s.p !== '"') {
      xs.push(parser ? parser(x.slice(s.last, s.i)) : x.slice(s.last, s.i))
      s.last = s.i + 1
    }
    s.p = s.char
  }
  s.last < s.i && xs.push(parser ? parser(x.slice(s.last, s.i + 1)) : x.slice(s.last, s.i + 1))
  return xs
}

module.exports.toCamel = x => {
  let str = x[0]
  for (let i = 1; i < x.length; i++)
    str += x[i] === '_' ? x[++i].toUpperCase() : x[i]
  return str
}

module.exports.toPascal = x => {
  let str = x[0].toUpperCase()
  for (let i = 1; i < x.length; i++)
    str += x[i] === '_' ? x[++i].toUpperCase() : x[i]
  return str
}

module.exports.toKebab = x => x.replace(/_/g, '-')

module.exports.errorFields = entries({
  S: 'severity_local',
  V: 'severity',
  C: 'code',
  M: 'message',
  D: 'detail',
  H: 'hint',
  P: 'position',
  p: 'internal_position',
  q: 'internal_query',
  W: 'where',
  s: 'schema_name',
  t: 'table_name',
  c: 'column_name',
  d: 'data type_name',
  n: 'constraint_name',
  F: 'file',
  L: 'line',
  R: 'routine'
}).reduce(char, {})
