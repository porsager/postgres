const char = (acc, [k, v]) => (acc[k.charCodeAt(0)] = v, acc)

// These were the fastest ways to do it in Node.js v12.11.1 (add tests to revise if this changes)
const types = module.exports.types = {
  string: {
    to: 25,
    from: null,             // defaults to string
    serialize: x => '' + x
  },
  number: {
    to: 1700,
    from: [20, 21, 23, 26, 700, 701, 790, 1700],
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
    from: [16],
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
    from: [17],
    serialize: x => '\\x' + x.toString('hex'),
    parse: x => Buffer.from(x.slice(2), 'hex')
  }
}

const defaultHandlers = typeHandlers(types)

const serializers = module.exports.serializers = defaultHandlers.serializers
const parsers = module.exports.parsers = defaultHandlers.parsers

module.exports.mergeUserTypes = function(types) {
  const user = typeHandlers(types || {})
  return {
    serializers: { ...serializers, ...user.serializers },
    parsers: { ...parsers, ...user.parsers }
  }
}

function typeHandlers(types) {
  return Object.entries(types).reduce((acc, [, type]) => {
    type.from && type.from.forEach(x => acc.parsers[x] = type.parse)
    acc.serializers[type.to] = type.serialize
    return acc
  }, { parsers: {}, serializers: {} })
}

const type = {
  number: 1700,
  boolean: 16
}

module.exports.escape = function escape(str) {
  let result = ''
  let q = str[0] < 10 || str[0] === '$'
  let last = 0
  let char
  let code

  for (let i = 0; i < str.length; i++) {
    const char = str[i]
    const code = char.charCodeAt(0)
    if (str[i] === '"') {
      q = true
      result += str.slice(last, i) + '"'
      last = i
    } else if (code === 96 || (code !== 36 && code <= 47) || (code >= 58 && code <= 64) || (code >= 91 && code <= 94) || (code >= 123 && code <= 128)) {
      q = true
    }
  }

  return (q ? '"' : '') + (q ? result + str.slice(last, str.length) : str) + (q ? '"' : '')
}

module.exports.inferType = function inferType(x) {
  return x.type || (x instanceof Date
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

const toCamel = module.exports.toCamel = x => {
  let str = x[0]
  for (let i = 1; i < x.length; i++)
    str += x[i] === '_' ? x[++i].toUpperCase() : x[i]
  return str
}

const toPascal = module.exports.toPascal = x => {
  let str = x[0].toUpperCase()
  for (let i = 1; i < x.length; i++)
    str += x[i] === '_' ? x[++i].toUpperCase() : x[i]
  return str
}

const toKebab = module.exports.toKebab = x => x.replace(/_/g, '-')

const errors = module.exports.errors = {
  connection: (x, options) => Object.assign(
    new Error('write CONNECTION_' + x + ' ' + options.path || (options.host + ':' + options.port)),
    {
      code: 'CONNECTION_' + x,
      errno: 'CONNECTION_' + x,
      address: options.path || options.host
    }, options.path ? {} : { port: options.port }
  ),

  generic: (x) => Object.assign(
    new Error(x.message),
    x
  ),

  notSupported: x => Object.assign(
    new Error(x + ' (B) is not supported'),
    {
      code: 'MESSAGE_NOT_SUPPORTED'
    }
  )
}

const errorFields = module.exports.errorFields = Object.entries({
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

const arrayTypes = module.exports.arrayTypes = {
  1000: 16,
  1001: 17,
  1002: 18,
  1003: 19,
  1016: 20,
  22: 21,
  1005: 21,
  1006: 22,
  1007: 23,
  1008: 24,
  1009: 25,
  30: 26,
  1028: 26,
  1010: 27,
  1011: 28,
  1012: 29,
  1013: 30,
  199: 114,
  143: 142,
  1017: 600,
  1018: 601,
  1019: 602,
  1020: 603,
  1027: 604,
  629: 628,
  651: 650,
  1021: 700,
  1022: 701,
  1023: 702,
  1024: 703,
  1025: 704,
  719: 718,
  775: 774,
  791: 790,
  1040: 829,
  1041: 869,
  1034: 1033,
  1014: 1042,
  1015: 1043,
  1182: 1082,
  1183: 1083,
  1115: 1114,
  1185: 1184,
  1187: 1186,
  1270: 1266,
  1561: 1560,
  1563: 1562,
  1231: 1700,
  2201: 1790,
  2207: 2202,
  2208: 2203,
  2209: 2204,
  2210: 2205,
  2211: 2206,
  1263: 2275,
  2951: 2950,
  2949: 2970,
  3221: 3220,
  3643: 3614,
  3645: 3615,
  3644: 3642,
  3735: 3734,
  3770: 3769,
  3807: 3802,
  3905: 3904,
  3907: 3906,
  3909: 3908,
  3911: 3910,
  3913: 3912,
  3927: 3926,
  4090: 4089,
  4097: 4096,
  13081: 13082,
  13084: 13085,
  13086: 13087,
  13091: 13092,
  13093: 13094,
  1698381: 1698382,
  1706612: 1706613,
  1706623: 1706624,
  1706643: 1706644
}
