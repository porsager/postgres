import { Query } from './query.js'
import { Errors } from './errors.js'

export const types = {
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
    to: 114,
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
    from: [1082, 1114, 1184],
    serialize: x => (x instanceof Date ? x : new Date(x)).toISOString(),
    parse: x => new Date(x)
  },
  bytea: {
    to: 17,
    from: 17,
    serialize: x => '\\x' + Buffer.from(x).toString('hex'),
    parse: x => Buffer.from(x.slice(2), 'hex')
  }
}

class NotTagged { then() { notTagged() } catch() { notTagged() } finally() { notTagged() }}

export class Identifier extends NotTagged {
  constructor(value) {
    super()
    this.value = escapeIdentifier(value)
  }
}

export class Parameter extends NotTagged {
  constructor(value, type, array) {
    super()
    this.value = value
    this.type = type
    this.array = array
  }
}

export class Builder extends NotTagged {
  constructor(first, rest) {
    super()
    this.first = first
    this.rest = rest
  }

  build(before, parameters, types, options) {
    const keyword = builders.map(([x, fn]) => ({ fn, i: before.search(x) })).sort((a, b) => a.i - b.i).pop()
    if (keyword.i === -1)
      throw new Error('Could not infer helper mode')

    return keyword.fn(this.first, this.rest, parameters, types, options)
  }
}

export function handleValue(x, parameters, types, options) {
  let value = x instanceof Parameter ? x.value : x
  if (value === undefined) {
    x instanceof Parameter
      ? x.value = options.transform.undefined
      : value = x = options.transform.undefined

    if (value === undefined)
      throw Errors.generic('UNDEFINED_VALUE', 'Undefined values are not allowed')
  }

  return '$' + (types.push(
    x instanceof Parameter
      ? (parameters.push(x.value), x.array
        ? x.array[x.type || inferType(x.value)] || x.type || firstIsString(x.value)
        : x.type
      )
      : (parameters.push(x), inferType(x))
  ))
}

const defaultHandlers = typeHandlers(types)

export function stringify(q, string, value, parameters, types, options) { // eslint-disable-line
  for (let i = 1; i < q.strings.length; i++) {
    string += (
      value instanceof Query ? fragment(value, parameters, types) :
      value instanceof Identifier ? value.value :
      value instanceof Builder ? value.build(string, parameters, types, options) :
      handleValue(value, parameters, types, options)
    ) + q.strings[i]
    value = q.args[i]
  }

  return string
}

function fragment(q, parameters, types) {
  q.fragment = true
  return stringify(q, q.strings[0], q.args[0], parameters, types)
}

function valuesBuilder(first, parameters, types, columns, options) {
  let value
  return first.map(row =>
    '(' + columns.map(column => {
      value = row[column]
      return (
        value instanceof Query ? fragment(value, parameters, types) :
        value instanceof Identifier ? value.value :
        handleValue(value, parameters, types, options)
      )
    }).join(',') + ')'
  ).join(',')
}

function values(first, rest, parameters, types, options) {
  const multi = Array.isArray(first[0])
  const columns = rest.length ? rest.flat() : Object.keys(multi ? first[0] : first)
  return valuesBuilder(multi ? first : [first], parameters, types, columns, options)
}

function select(first, rest, parameters, types, options) {
  typeof first === 'string' && (first = [first].concat(rest))
  if (Array.isArray(first))
    return first.map(x => escapeIdentifier(options.transform.column.to ? options.transform.column.to(x) : x)).join(',')

  let value
  const columns = rest.length ? rest.flat() : Object.keys(first)
  return columns.map(x => {
    value = first[x]
    return (
      value instanceof Query ? fragment(value, parameters, types) :
      value instanceof Identifier ? value.value :
      handleValue(value, parameters, types, options)
    ) + ' as ' + escapeIdentifier(options.transform.column.to ? options.transform.column.to(x) : x)
  }).join(',')
}

const builders = Object.entries({
  values,
  in: values,
  select,
  returning: select,

  update(first, rest, parameters, types, options) {
    return (rest.length ? rest.flat() : Object.keys(first)).map(x =>
      escapeIdentifier(options.transform.column.to ? options.transform.column.to(x) : x) +
      '=' + handleValue(first[x], parameters, types, options)
    )
  },

  insert(first, rest, parameters, types, options) {
    const columns = rest.length ? rest.flat() : Object.keys(Array.isArray(first) ? first[0] : first)
    return '(' + columns.map(x =>
      escapeIdentifier(options.transform.column.to ? options.transform.column.to(x) : x)
    ).join(',') + ')values' +
    valuesBuilder(Array.isArray(first) ? first : [first], parameters, types, columns, options)
  }
}).map(([x, fn]) => ([new RegExp('(^|[\\s(])' + x + '($|[\\s(])', 'i'), fn]))

function notTagged() {
  throw Errors.generic('NOT_TAGGED_CALL', 'Query not called as a tagged template literal')
}

export const serializers = defaultHandlers.serializers
export const parsers = defaultHandlers.parsers

export const END = {}

function firstIsString(x) {
  if (Array.isArray(x))
    return firstIsString(x[0])
  return typeof x === 'string' ? 1009 : 0
}

export const mergeUserTypes = function(types) {
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
    types[k].from && [].concat(types[k].from).forEach(x => acc.serializers[x] = types[k].serialize)
    return acc
  }, { parsers: {}, serializers: {} })
}

export const escapeIdentifier = function escape(str) {
  return '"' + str.replace(/"/g, '""').replace(/\./g, '"."') + '"'
}

export const inferType = function inferType(x) {
  return (
    x instanceof Parameter ? x.type :
    x instanceof Date ? 1184 :
    x instanceof Uint8Array ? 17 :
    (x === true || x === false) ? 16 :
    typeof x === 'bigint' ? 20 :
    Array.isArray(x) ? inferType(x[0]) :
    0
  )
}

const escapeBackslash = /\\/g
const escapeQuote = /"/g

function arrayEscape(x) {
  return x
    .replace(escapeBackslash, '\\\\')
    .replace(escapeQuote, '\\"')
}

export const arraySerializer = function arraySerializer(xs, serializer) {
  if (Array.isArray(xs) === false)
    return xs

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

export const arrayParser = function arrayParser(x, parser) {
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
