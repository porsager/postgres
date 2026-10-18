import { t } from '../test.js'
import { Types } from '../../src/types.js'

const types = Types({})
    , parse = (oid, x) => types.parser(oid)(x)
    , serialize = (oid, x) => types.serializer(oid)(x)

const show = x => Array.isArray(x)
  ? '[' + x.map(show) + ']'
  : x === null ? 'null'
  : x instanceof Date ? 'date:' + (isNaN(x) ? 'invalid' : x.toISOString())
  : Buffer.isBuffer(x) ? 'buffer:' + x.toString('hex')
  : typeof x === 'object' ? 'object:' + JSON.stringify(x)
  : typeof x + ':' + x

const local = (year, ...rest) => {
  const x = new Date(2000, ...rest)
  x.setFullYear(year)
  return x
}

t('Parse scalars as v3 does', async() => [
  'number:1,number:-2,number:3,number:1.5,number:2.25,string:9007199254740993,string:1.10,boolean:true,boolean:false,string:x',
  [
    parse(21, '1'), parse(23, '-2'), parse(26, '3'), parse(700, '1.5'), parse(701, '2.25'),
    parse(20, '9007199254740993'), parse(1700, '1.10'),
    parse(16, 't'), parse(16, 'f'), parse(25, 'x')
  ].map(show).join()
])

t('Parse json and jsonb', async() => [
  'object:{"a":[1,null]}|object:{"b":true}',
  show(parse(114, '{"a":[1,null]}')) + '|' + show(parse(3802, '{"b":true}'))
])

t('Parse bytea hex', async() => [
  'buffer:00ff10',
  show(parse(17, '\\x00ff10'))
])

t('Parse timestamptz with offsets', async() => [
  [
    'date:2024-01-02T03:04:05.678Z',
    'date:2024-01-02T01:04:05.000Z',
    'date:2024-01-02T08:34:05.000Z',
    'date:2024-01-02T03:04:05.123Z'
  ].join(),
  [
    '2024-01-02 03:04:05.678+00',
    '2024-01-02 03:04:05+02',
    '2024-01-02 03:04:05-05:30',
    '2024-01-02 03:04:05.123456+00'
  ].map(x => show(parse(1184, x))).join()
])

t('Parse timestamptz with an offset in seconds', async() => [
  'date:1850-06-15T12:30:00.000Z',
  show(parse(1184, '1850-06-15 13:20:20+00:50:20'))
])

t('Parse timestamptz before year 100 (#1185)', async() => [
  'date:0050-06-15T12:30:00.000Z|date:0050-06-15T12:30:00.000Z|date:0001-01-01T00:00:00.000Z',
  [
    '0050-06-15 12:30:00+00',
    '0050-06-15 13:20:20+00:50:20',
    '0001-01-01 00:00:00+00'
  ].map(x => show(parse(1184, x))).join('|')
])

t('Parse timestamp without time zone as local time, like v3', async() => [
  local(2024, 0, 2, 3, 4, 5, 678).getTime() + ',' + local(50, 5, 15, 12, 30).getTime(),
  parse(1114, '2024-01-02 03:04:05.678').getTime() + ',' + parse(1114, '0050-06-15 12:30:00').getTime()
])

t('Parse date as UTC midnight, like v3', async() => [
  'date:2024-01-02T00:00:00.000Z|date:0050-06-15T00:00:00.000Z',
  show(parse(1082, '2024-01-02')) + '|' + show(parse(1082, '0050-06-15'))
])

t('Parse infinity for every date type (#728)', async() => [
  'number:Infinity,number:-Infinity,'.repeat(3).slice(0, -1),
  [1082, 1114, 1184].flatMap(oid => [parse(oid, 'infinity'), parse(oid, '-infinity')]).map(show).join()
])

t('Serialize infinity for every date type (#728)', async() => [
  'infinity,-infinity,'.repeat(3).slice(0, -1),
  [1082, 1114, 1184].flatMap(oid => [serialize(oid, Infinity), serialize(oid, -Infinity)]).join()
])

t('Serialize dates as ISO, including before year 100', async() => {
  const old = new Date(Date.UTC(2000, 5, 15, 12, 30))
  old.setUTCFullYear(50)
  return [
    '1970-01-01T00:00:00.000Z,0050-06-15T12:30:00.000Z,1970-01-01T00:00:01.000Z',
    [new Date(0), old, 1000].map(x => serialize(1184, x)).join()
  ]
})

t('Serialize booleans, json and bytea', async() => [
  't|f|{"a":1}|\\x00ff',
  [serialize(16, true), serialize(16, false), serialize(114, { a: 1 }), serialize(17, Buffer.from([0, 255]))].join('|')
])

t('Infer types with the v3 rules, and arrays as their array type', async() => [
  '1184,17,17,16,16,20,0,0,0,0,1185,0',
  [
    new Date(), Buffer.from([]), new Uint8Array(1), true, false, 1n, 1, 'a', null, {},
    [new Date()], []
  ].map(types.infer).join()
])

t('Parse built-in arrays without a fetch', async() => [
  [
    '[number:1,number:2]', '[string:a,string:b c]', '[boolean:true,boolean:false]', '[string:1,string:2]',
    '[date:1970-01-01T00:00:00.000Z]', '[object:{"a":1}]', '[buffer:01]'
  ].join('|'),
  [
    parse(1007, '{1,2}'),
    parse(1009, '{a,"b c"}'),
    parse(1000, '{t,f}'),
    parse(1016, '{1,2}'),
    parse(1185, '{"1970-01-01 00:00:00+00"}'),
    parse(199, '{"{\\"a\\":1}"}'),
    parse(1001, '{"\\\\x01"}')
  ].map(show).join('|')
])

t('Parse infinity in timestamp arrays', async() => [
  '[number:Infinity,number:-Infinity,null]',
  show(parse(1185, '{infinity,-infinity,NULL}'))
])

t('Array NULL is null', async() => [
  '[number:1,null,number:3]|[null,string:a,null]',
  show(parse(1007, '{1,NULL,3}')) + '|' + show(parse(1009, '{NULL,a,NULL}'))
])

t('Array quoted "NULL" stays a string', async() => [
  '[string:NULL,null,string:a b,null,string:NULL]',
  show(parse(1009, '{"NULL",NULL,"a b",NULL,"NULL"}'))
])

t('Array NULL in nested arrays', async() => [
  '[[number:1,null],[null,number:4]]',
  show(parse(1007, '{{1,NULL},{NULL,4}}'))
])

t('Array NULL with the box ; delimiter', async() => [
  '[string:(1,2),(3,4),null]',
  show(parse(1020, '{(1,2),(3,4);NULL}'))
])

t('Array parser is not called for NULL', async() => {
  const parsed = []
      , types = Types({ types: { text: { to: 25, from: [25], serialize: x => x, parse: x => parsed.push(x) } } })
  types.parser(1009)('{a,NULL,"NULL"}')
  return ['a,NULL', parsed.join()]
})

t('Array of only NULL, empty arrays and empty strings', async() => [
  '[null,null]|[]|[string:,string:a]',
  show(parse(1009, '{NULL,NULL}')) + '|' + show(parse(1009, '{}')) + '|' + show(parse(1009, '{"",a}'))
])

t('Array escapes', async() => [
  '[string:Hello "you",string:c:\\windows,string:{x},string:a,b]',
  show(parse(1009, '{"Hello \\"you\\"","c:\\\\windows","{x}","a,b"}'))
])

t('Array with explicit bounds', async() => [
  '[number:1,number:2]',
  show(parse(1007, '[0:1]={1,2}'))
])

t('Serialize arrays', async() => [
  '{"1",NULL,"3"}|{{"a"},{"b"}}|{"NULL"}|{"Hello \\"you\\"","c:\\\\windows"}|{}|{"(1,2),(3,4)";"(5,6),(7,8)"}',
  [
    serialize(1007, [1, null, 3]),
    serialize(1009, [['a'], ['b']]),
    serialize(1009, ['NULL']),
    serialize(1009, ['Hello "you"', 'c:\\windows']),
    serialize(1009, []),
    serialize(1020, ['(1,2),(3,4)', '(5,6),(7,8)'])
  ].join('|')
])

t('Serialize arrays with the element serializer', async() => [
  '{"t","f",NULL}',
  serialize(1000, [true, false, null])
])

t('Array round trip keeps NULL and "NULL" apart', async() => [
  '[string:NULL,null,string:a]',
  show(parse(1009, serialize(1009, ['NULL', null, 'a'])))
])

t('Parse timestamptz in a DateStyle other than ISO as Date does', async() => [
  'date:2026-10-19T12:00:00.000Z',
  show(parse(1184, 'Mon Oct 19 12:00:00 2026 UTC'))
])
