import { Errors } from './errors.js'

const number = x => +x
    , bool = x => x === 't'
    , json = x => JSON.parse(x)
    , string = x => x instanceof Date ? serializeDate(x) : Array.isArray(x) ? serializeArray(x, string) : literal(x) ? JSON.stringify(x) : '' + x
    , literal = x => x !== null && typeof x === 'object' && (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null)

const arrays = {
  16: 1000, 17: 1001, 18: 1002, 19: 1003, 20: 1016, 21: 1005, 22: 1006, 23: 1007, 24: 1008,
  25: 1009, 26: 1028, 27: 1010, 28: 1011, 29: 1012, 30: 1013, 114: 199, 142: 143, 600: 1017,
  601: 1018, 602: 1019, 603: 1020, 604: 1027, 628: 629, 650: 651, 700: 1021, 701: 1022, 718: 719,
  774: 775, 790: 791, 829: 1040, 869: 1041, 1033: 1034, 1042: 1014, 1043: 1015, 1082: 1182,
  1083: 1183, 1114: 1115, 1184: 1185, 1186: 1187, 1266: 1270, 1560: 1561, 1562: 1563, 1700: 1231,
  1790: 2201, 2202: 2207, 2203: 2208, 2204: 2209, 2205: 2210, 2206: 2211, 2249: 2287, 2275: 1263,
  2950: 2951, 2970: 2949, 3220: 3221, 3614: 3643, 3615: 3645, 3734: 3735, 3769: 3770, 3802: 3807,
  3904: 3905, 3906: 3907, 3908: 3909, 3910: 3911, 3912: 3913, 3926: 3927, 4072: 4073, 4089: 4090,
  4096: 4097, 5038: 5039, 5069: 271
}

export const types = {
  string: { to: 25, from: null, serialize: string },
  number: { to: 0, from: [21, 23, 26, 700, 701], serialize: string, parse: number },
  json: { to: 114, from: [114, 3802], serialize: x => JSON.stringify(x), parse: json },
  boolean: { to: 16, from: [16], serialize: x => x === true ? 't' : 'f', parse: bool },
  date: { to: 1184, from: [1082, 1114, 1184], serialize: serializeDate, parse: null },
  bytea: { to: 17, from: [17], serialize: x => '\\x' + Buffer.from(x).toString('hex'), parse: x => Buffer.from(x.slice(2), 'hex') }
}

const dates = { 1082: parseDate, 1114: parseTimestamp, 1184: parseTimestamptz }

function integer(x, i, end) {
  const negative = x[i] === 45
  let n = 0
  for (negative && i++; i < end; i++)
    n = n * 10 + x[i] - 48
  return negative ? -n : n
}

function boolean(x, i) {
  return x[i] === 116
}

const shaped = (is, serialize) => x => is(x) ? serialize(x) : string(x)

const shapedTypes = {
  ...types,
  boolean: { ...types.boolean, serialize: shaped(x => typeof x === 'boolean', types.boolean.serialize) },
  date: { ...types.date, serialize: shaped(x => x instanceof Date, types.date.serialize) },
  bytea: { ...types.bytea, serialize: shaped(x => x instanceof Uint8Array, types.bytea.serialize) }
}

export function Types(options = {}) {
  const parsers = {}
      , serializers = {}
      , elements = {}
      , undefinedValue = options.transform && options.transform.undefined

  Object.entries(arrays).forEach(([oid, array]) => elements[array] = [+oid, +oid === 603 ? ';' : ','])
  register(options.infer === false ? shapedTypes : types)
  Object.assign(parsers, dates)
  options.infer === false && (parsers[1114] = parseDate)
  const custom = Object.values(options.types || {})
      , named = custom.filter(x => [x.to].concat(x.from || []).some(y => typeof y === 'string'))
      , oids = {}

  register(custom.filter(x => !named.includes(x)))

  const bases = {}

  return { parser, decoder, serializer, load, infer, resolve, named: named.length > 0, parsers, serializers }

  function resolve(type) {
    return typeof type === 'string' ? oids[type] || 0 : type
  }

  function decoder(oid, parse) {
    return parse === number && (oid === 21 || oid === 23 || oid === 26) ? integer
      : parse === bool && oid === 16 ? boolean
      : null
  }

  function register(xs) {
    Object.values(xs).forEach(x => {
      const from = [].concat(x.from || [])
      x.parse && from.forEach(oid => parsers[oid] = x.parse)
      if (x.serialize) {
        serializers[x.to] = x.serialize
        from.forEach(oid => serializers[oid] = x.serialize)
      }
    })
  }

  function parser(oid) {
    if (oid in parsers)
      return parsers[oid]

    if (oid in bases)
      return parsers[oid] = parser(bases[oid])

    if (oid in elements) {
      const [element, delimiter] = elements[oid]
          , parse = parser(element)
      return parsers[oid] = x => parseArray(x, parse === identity ? null : parse, delimiter)
    }

    return identity
  }

  function serializer(oid) {
    if (oid in serializers)
      return serializers[oid]

    if (oid in bases)
      return serializers[oid] = serializer(bases[oid])

    if (oid in elements) {
      const [element, delimiter] = elements[oid]
          , serialize = serializer(element)
      return serializers[oid] = xs => Array.isArray(xs) ? serializeArray(xs, serialize, delimiter, undefinedValue) : serialize(xs)
    }

    return string
  }

  function load(run) {
    return Promise.all([fetched(run), named.length && names(run)])
  }

  async function names(run) {
    const wanted = [...new Set(named.flatMap(x => [x.to].concat(x.from || [])).filter(x => typeof x === 'string'))]
        , list = wanted.map(x => '\'' + x.split('.').pop().replace(/'/g, '\'\'') + '\'').join(',')
        , rows = await run(
          'select t.oid::int, t.typarray::int as array, t.typdelim as delimiter, t.typname as name, n.nspname as schema, '
          + 'pg_catalog.pg_type_is_visible(t.oid) as visible from pg_catalog.pg_type t '
          + 'join pg_catalog.pg_namespace n on n.oid = t.typnamespace where t.typname in (' + list + ')'
        )
        , missing = []
    wanted.forEach(x => {
      const [schema, name] = x.includes('.') ? x.split('.') : [null, x]
          , row = rows.find(r => r.name === name && (schema ? r.schema === schema : r.visible))
      row ? (oids[x] = row.oid, row.array && !(row.array in elements) && (elements[row.array] = [row.oid, row.delimiter])) : missing.push(x)
    })
    if (missing.length) {
      throw Errors.generic('TYPE_NOT_FOUND', missing.length > 1
        ? 'The types ' + missing.join(', ') + ' do not exist'
        : 'The type ' + missing[0] + ' does not exist')
    }
    register(named.map(x => ({ ...x, to: resolve(x.to), from: [].concat(x.from || []).map(resolve) })))
  }

  function fetched(run) {
    return run(
      'select oid::int, typelem::int as element, typdelim as delimiter, typbasetype::int as base, typtype as kind '
      + 'from pg_catalog.pg_type where typtype = \'d\' or (typcategory = \'A\' and oid >= 16384)'
    ).then(rows => rows.forEach(({ oid, element, delimiter, base, kind }) => {
      if (oid in parsers || oid in serializers)
        return
      kind === 'd'
        ? bases[oid] = base
        : element && !(oid in elements) && (elements[oid] = [element, delimiter])
    }))
  }
}

const identity = x => x
identity.identity = true

export class Parameter {
  constructor(value, type) {
    this.value = value
    this.type = type
  }
}

export function infer(x) {
  return (
    x instanceof Parameter ? x.type :
    x instanceof Date ? 1184 :
    x instanceof Uint8Array ? 17 :
    (x === true || x === false) ? 16 :
    typeof x === 'bigint' ? 20 :
    Array.isArray(x) ? arrays[infer(x[0])] || 0 :
    0
  )
}

export function parseArray(x, parse, delimiter = ',') {
  let i = x[0] === '[' ? x.indexOf('=') + 1 : 0
  return level()

  function level() {
    const xs = []
    i++
    while (i < x.length && x[i] !== '}') {
      if (x[i] === '{') {
        xs.push(level())
      } else if (x[i] === '"') {
        let s = ''
        for (i++; x[i] !== '"'; i++)
          s += x[i] === '\\' ? x[++i] : x[i]
        i++
        xs.push(parse ? parse(s) : s)
      } else {
        const start = i
        while (x[i] !== delimiter && x[i] !== '}')
          i++
        const s = x.slice(start, i)
        xs.push(s === 'NULL' ? null : parse ? parse(s) : s)
      }
      x[i] === delimiter && i++
    }
    i++
    return xs
  }
}

export function serializeArray(xs, serialize = string, delimiter = ',', undefinedValue) {
  return '{' + xs.map(x => {
    const typed = x instanceof Parameter
    typed && (x = x.value)
    x === undefined && (x = undefinedValue)
    if (x === undefined)
      throw Errors.generic('UNDEFINED_VALUE', 'Undefined values are not allowed')
    return Array.isArray(x) && !typed
      ? serializeArray(x, serialize, delimiter, undefinedValue)
      : x === null
        ? 'NULL'
        : '"' + ('' + serialize(x)).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
  }).join(delimiter) + '}'
}

function serializeDate(x) {
  return x === Infinity ? 'infinity'
       : x === -Infinity ? '-infinity'
       : (x instanceof Date ? x : new Date(x)).toISOString()
}

const timestamp = /^(\d{4,})-(\d\d)-(\d\d)(?: (\d\d):(\d\d):(\d\d)(?:\.(\d+))?)?(?:([+-])(\d\d)(?::(\d\d))?(?::(\d\d))?)?( BC)?$/

function parts(x) {
  const m = x.match(timestamp)
  if (!m)
    return null

  const year = m[12] ? 1 - m[1] : +m[1]
      , ms = m[7] ? +(m[7] + '00').slice(0, 3) : 0
      , offset = m[8] ? (m[8] === '-' ? -1 : 1) * ((m[9] * 60 + +(m[10] || 0)) * 60 + +(m[11] || 0)) * 1000 : 0

  return { year, month: m[2] - 1, day: +m[3], hour: +(m[4] || 0), minute: +(m[5] || 0), second: +(m[6] || 0), ms, offset }
}

function infinite(x) {
  return x === 'infinity' ? Infinity : x === '-infinity' ? -Infinity : null
}

function utc(x) {
  const date = new Date(Date.UTC(2000, x.month, x.day, x.hour, x.minute, x.second, x.ms))
  date.setUTCFullYear(x.year)
  return date
}

function plain(x) {
  const n = x.length
  return x.charCodeAt(0) !== 48 && x.charCodeAt(n - 1) !== 67 && !(x.charCodeAt(n - 3) === 58 && x.charCodeAt(n - 6) === 58)
    && x.charCodeAt(0) !== 45 && x.charCodeAt(0) !== 105
}

function parseTimestamptz(x) {
  if (plain(x))
    return new Date(x)

  const p = infinite(x) || parts(x)
  if (!p)
    return new Date(x)

  if (typeof p === 'number')
    return p

  const date = utc(p)
  date.setTime(date.getTime() - p.offset)
  return date
}

function parseDate(x) {
  const p = infinite(x) || parts(x)
  return !p ? new Date(x) : typeof p === 'number' ? p : utc(p)
}

function parseTimestamp(x) {
  const p = infinite(x) || parts(x)
  if (!p || typeof p === 'number')
    return p || new Date(x)

  const date = new Date(2000, p.month, p.day, p.hour, p.minute, p.second, p.ms)
  date.setFullYear(p.year)
  return date
}

export const toCamel = x => {
  let str = x[0]
  for (let i = 1; i < x.length; i++)
    str += x[i] === '_' ? x[++i].toUpperCase() : x[i]
  return str
}

export const toPascal = x => {
  let str = x[0].toUpperCase()
  for (let i = 1; i < x.length; i++)
    str += x[i] === '_' ? x[++i].toUpperCase() : x[i]
  return str
}

export const toKebab = x => x.replace(/_/g, '-')

export const fromCamel = x => x.replace(/([A-Z])/g, '_$1').toLowerCase()
export const fromPascal = x => (x.slice(0, 1) + x.slice(1).replace(/([A-Z])/g, '_$1')).toLowerCase()
export const fromKebab = x => x.replace(/-/g, '_')

function createJsonTransform(fn) {
  return function jsonTransform(x, column) {
    return typeof x === 'object' && x !== null && (column.type === 114 || column.type === 3802)
      ? Array.isArray(x)
        ? x.map(x => jsonTransform(x, column))
        : Object.entries(x).reduce((acc, [k, v]) => Object.assign(acc, { [fn(k)]: jsonTransform(v, column) }), {})
      : x
  }
}

toCamel.column = { from: toCamel }
toCamel.value = { from: createJsonTransform(toCamel) }
fromCamel.column = { to: fromCamel }

export const camel = { ...toCamel }
camel.column.to = fromCamel

toPascal.column = { from: toPascal }
toPascal.value = { from: createJsonTransform(toPascal) }
fromPascal.column = { to: fromPascal }

export const pascal = { ...toPascal }
pascal.column.to = fromPascal

toKebab.column = { from: toKebab }
toKebab.value = { from: createJsonTransform(toKebab) }
fromKebab.column = { to: fromKebab }

export const kebab = { ...toKebab }
kebab.column.to = fromKebab
