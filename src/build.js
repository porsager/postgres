import { Errors } from './errors.js'
import { Parameter, infer } from './types.js'

export const isQuery = Symbol('query')

class NotTagged {
  then() { notTagged() }
  catch() { notTagged() }
  finally() { notTagged() }
}

export class Identifier extends NotTagged {
  constructor(value) {
    super()
    this.value = escapeIdentifier(value)
  }
}

export class Join {
  constructor(separator, items) {
    this.separator = separator
    this.items = items
  }
}

export const joinStrings = Object.assign(['', ''], { raw: ['', ''] })

export class Builder extends NotTagged {
  constructor(first, rest) {
    super()
    this.first = first
    this.rest = rest
  }
}

export function build(query, options) {
  const values = []
      , oids = []
      , o = { transform: options.transform, infer: options.infer !== false, resolve: options.resolve, values, oids, dynamic: !query.tagged }

  const text = query.tagged
    ? stringify(query, o)
    : (query.args.forEach(x => value(x, o)), '' + query.strings[0])

  if (values.length >= 65534)
    throw Errors.generic('MAX_PARAMETERS_EXCEEDED', 'Max number of parameters (65534) exceeded')

  const types = oids.join()
  return { strings: query.strings, dynamic: o.dynamic, types, text, values, oids }
}

function stringify(q, o) {
  let string = q.strings[0]

  for (let i = 1; i < q.strings.length; i++)
    string += part(string, q.args[i - 1], o, q.strings[i]) + q.strings[i]

  return string
}

function part(before, x, o, after = '') {
  if (x instanceof Builder || x instanceof Identifier || isFragment(x) || (Array.isArray(x) && isFragment(x[0])))
    o.dynamic = true

  return isFragment(x) && x.strings === joinStrings ? joined(x.args[0], o, before, after)
    : x instanceof Join ? joined(x, o, '', '')
    : x instanceof Builder ? helper(before, x, o)
    : isFragment(x) ? fragment(x, o)
    : x instanceof Identifier ? x.value
    : Array.isArray(x) && isFragment(x[0]) ? x.reduce((acc, x) => acc + ' ' + fragment(x, o), '')
    : value(x, o)
}

function joined(join, o, before, after) {
  let text = ''
  join.items.forEach((item, i) => {
    i > 0 && (text = spaced(text, fragment(join.separator, o)))
    text = spaced(text, part('', item, o))
  })
  before && text && !/\s$/.test(before) && !/^\s/.test(text) && (text = ' ' + text)
  after && text && !/^\s/.test(after) && !/\s$/.test(text) && (text = text + ' ')
  return text
}

function spaced(a, b) {
  return a && b && !/\s$/.test(a) && !/^\s/.test(b) ? a + ' ' + b : a + b
}

function isFragment(x) {
  return !!x && x[isQuery] === true
}

function fragment(q, o) {
  return q.tagged ? stringify(q, o) : q.strings[0]
}

export function value(x, o) {
  let v = x instanceof Parameter ? x.value : x
  if (v === undefined) {
    v = o.transform.undefined
    if (v === undefined)
      throw Errors.generic('UNDEFINED_VALUE', 'Undefined values are not allowed')
    x instanceof Parameter || (x = v)
  }
  o.values.push(v)
  o.oids.push(x instanceof Parameter ? o.resolve(x.type) : o.infer ? infer(x) : 0)
  return '$' + o.values.length
}

const builders = {
  values,
  in: (...xs) => {
    const x = values(...xs)
    return x === '()' ? '(null)' : x
  },
  select,
  update,
  insert,
  call
}

function call(first, rest, o) {
  if (first === null || typeof first !== 'object' || Array.isArray(first) || isFragment(first))
    return select(first, rest, o)

  return columns(first, rest).map(x =>
    escapeIdentifier(column(x, o)) + ' => ' + part('values', first[x], o)
  ).join(',')
}

const clauses = { in: 'in', values: 'values', select: 'select', returning: 'select', set: 'update', distinct: 'select' }
    , stops = new Set([
      'from', 'where', 'on', 'to', 'join', 'group', 'order', 'by', 'having', 'limit', 'offset', 'union',
      'intersect', 'except', 'using', 'and', 'or', 'when', 'then', 'else', 'with', 'table', 'grant',
      'revoke', 'delete', 'update', 'case', 'not', 'like', 'ilike', 'between', 'is', 'exists', 'conflict',
      'do', 'nothing', 'window', 'over', 'partition', 'filter', 'lateral', 'cross', 'inner', 'left', 'right',
      'full', 'outer', 'natural', 'into'
    ])

function helper(before, x, o) {
  const kind = context(before)
  return kind ? builders[kind](x.first, x.rest, o) : identifiers(typeof x.first === 'string' ? [x.first].concat(x.rest) : x.first, o)
}

function context(sql) {
  const words = []

  let i = sql.length - 1
    , depth = 0

  while (i >= 0) {
    const c = sql[i]
    if (c === ')') {
      depth++
      i--
    } else if (c === '(') {
      if (depth === 0) {
        const word = previous(sql, i - 1)
        if (words.length === 0)
          return word === 'in' || word === 'values' ? word : word && !clauses[word] && !stops.has(word) ? 'call' : 'select'
        return 'select'
      }
      depth--
      i--
    } else if (c === '\'' || c === '"') {
      const end = i
      i--
      while (i >= 0 && !(sql[i] === c && sql[i - 1] !== c))
        sql[i] === c ? i -= 2 : i--
      i--
      if (sql[i] === '.')
        i--
      else
        depth === 0 && c === '"' && words.push(sql.slice(i + 1, end + 1))
    } else if (/[a-z_0-9$]/i.test(c)) {
      const end = i + 1
      while (i >= 0 && /[a-z_0-9$.]/i.test(sql[i]))
        i--
      const word = depth === 0 && sql.slice(i + 1, end).toLowerCase()
      if (word && clauses[word])
        return clauses[word]
      if (word === 'into')
        return insert_into(words, sql, i) ? 'insert' : null
      if (word && stops.has(word))
        return null
      word && words.push(word)
    } else {
      i--
    }
  }
  return null
}

function previous(sql, i) {
  while (i >= 0 && /\s/.test(sql[i]))
    i--

  if (sql[i] === '"')
    return '"'

  const end = i + 1
  while (i >= 0 && /[a-z_0-9$.]/i.test(sql[i]))
    i--

  return sql.slice(i + 1, end).toLowerCase()
}

function insert_into(words, sql, i) {
  const target = words.length === 1 || (words.length === 3 && words[1] === 'as')
  return target && previous(sql, i) === 'insert'
}

function valuesBuilder(first, columns, o) {
  return first.map(row =>
    '(' + columns.map(x => part('values', row[x], o)).join(',') + ')'
  ).join(',')
}

function values(first, rest, o) {
  const rows = Array.isArray(first) && first.length > 0 && first[0] !== null && typeof first[0] === 'object' && !isFragment(first[0])
      , picked = columns(rows ? first[0] : first, rest)

  return valuesBuilder(rows ? first : [first], picked, o)
}

function update(first, rest, o) {
  const picked = columns(first, rest)
  picked.length || empty('update')

  return picked.map(x =>
    escapeIdentifier(column(x, o)) + '=' + part('values', first[x], o)
  )
}

function insert(first, rest, o) {
  if (Array.isArray(first) && first.every(x => typeof x === 'string'))
    return '(' + escapeIdentifiers(first.concat(rest.flat()), o) + ')'

  const picked = columns(Array.isArray(first) ? first[0] || {} : first, rest)
  picked.length || empty('insert')

  return '(' + escapeIdentifiers(picked, o) + ')values' + valuesBuilder(Array.isArray(first) ? first : [first], picked, o)
}

function columns(first, rest) {
  return rest.length ? rest.flat() : Object.keys(first)
}

function empty(x) {
  throw Errors.generic('NO_COLUMNS', 'The ' + x + ' helper got no columns')
}

function identifiers(first, o) {
  return Array.isArray(first)
    ? first.map(x => member(x, o)).join(',')
    : member(first, o)
}

function member(x, o) {
  return isFragment(x) ? fragment(x, o) : x instanceof Identifier ? x.value : escapeIdentifier(column(x, o))
}

function select(first, rest, o) {
  typeof first === 'string' && (first = [first].concat(rest))
  if (Array.isArray(first))
    return identifiers(first, o)

  return columns(first, rest).map(x => {
    const v = first[x]
    return (
      isFragment(v) ? fragment(v, o) :
      v instanceof Identifier ? v.value :
      value(v, o)
    ) + ' as ' + escapeIdentifier(column(x, o))
  }).join(',')
}

function column(x, o) {
  return o.transform.column.to ? o.transform.column.to(x) : x
}

function escapeIdentifiers(xs, o) {
  return xs.map(x => escapeIdentifier(column(x, o))).join(',')
}

export function escapeIdentifier(x) {
  return '"' + x.replace(/"/g, '""').replace(/\./g, '"."') + '"'
}

export function notTagged() {
  throw Errors.generic('NOT_TAGGED_CALL', 'Query not called as a tagged template literal')
}
