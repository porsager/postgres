export default [
  ['Parameters are numbered', sql => sql`select ${ 1 }, ${ 'a' }`, 'select $1, $2', [1, 'a']],
  ['No parameters', sql => sql`select 1`, 'select 1', []],
  ['Fragment', sql => sql`select ${ 1 } ${ sql`where x = ${ 2 }` }`, 'select $1 where x = $2', [1, 2]],
  [
    'Nested fragments keep parameter order',
    sql => sql`select ${ 1 } ${ sql`where ${ sql`x = ${ 2 }` } and y = ${ 3 }` }`,
    'select $1 where x = $2 and y = $3', [1, 2, 3]
  ],
  ['Array of fragments', sql => sql`select 1 ${ [sql`, ${ 2 }`, sql`, 3`] }`, 'select 1  , $1 , 3', [2]],
  ['Unsafe fragment', sql => sql`select ${ sql.unsafe('1 as x') }`, 'select 1 as x', []],
  ['Unsafe with parameters', sql => sql.unsafe('select $1', [1]), 'select $1', [1]],
  ['Identifier', sql => sql`select 1 as ${ sql('a') }`, 'select 1 as "a"', []],
  ['Identifier with schema and quote', sql => sql`select * from ${ sql('s.t"x') }`, 'select * from "s"."t""x"', []],
  ['Select columns', sql => sql`select ${ sql(['a', 'b']) } from x`, 'select "a","b" from x', []],
  ['Select object', sql => sql`select ${ sql({ a: 1, b: sql`now()` }) }`, 'select $1 as "a",now() as "b"', [1]],
  ['Insert object', sql => sql`insert into x ${ sql({ a: 1, b: 'b' }) }`, 'insert into x ("a","b")values($1,$2)', [1, 'b']],
  ['Insert array of objects', sql => sql`insert into x ${ sql([{ a: 1 }, { a: 2 }]) }`, 'insert into x ("a")values($1),($2)', [1, 2]],
  ['Insert picked columns', sql => sql`insert into x ${ sql({ a: 1, b: 2 }, 'b') }`, 'insert into x ("b")values($1)', [2]],
  ['Update object', sql => sql`update x set ${ sql({ a: 1, b: 2 }) } where id = ${ 3 }`, 'update x set "a"=$1,"b"=$2 where id = $3', [1, 2, 3]],
  ['Update picked columns', sql => sql`update x set ${ sql({ a: 1, b: 2 }, ['a']) }`, 'update x set "a"=$1', [1]],
  ['In list', sql => sql`select 1 where x in ${ sql([1, 2]) }`, 'select 1 where x in ($1,$2)', [1, 2]],
  ['In empty list', sql => sql`select 1 where x in ${ sql([]) }`, 'select 1 where x in (null)', []],
  ['In list of rows', sql => sql`select 1 where (x, y) in ${ sql([[1, 2], [3, 4]]) }`, 'select 1 where (x, y) in ($1,$2),($3,$4)', [1, 2, 3, 4]],
  ['Values rows', sql => sql`select * from (values ${ sql([[1, 'a'], [2, 'b']]) }) v`, 'select * from (values ($1,$2),($3,$4)) v', [1, 'a', 2, 'b']],
  ['Identifiers outside a clause', sql => sql`select * from x order by ${ sql('a', 'b') }`, 'select * from x order by "a","b"', []],
  ['Fragment as identifiers', sql => sql`select * from x order by ${ sql(sql`a desc`) }`, 'select * from x order by a desc', []],
  ['Columns after a parenthesis', sql => sql`select (1) as a, ${ sql(['b']) } from x`, 'select (1) as a, "b" from x', []],
  ['Columns inside a parenthesis', sql => sql`select (a, ${ sql(['b', 'c']) })`, 'select (a, "b","c")', []],
  ['Returning columns', sql => sql`delete from x returning ${ sql(['a', 'b']) }`, 'delete from x returning "a","b"', []],
  ['Json parameter', sql => sql`select ${ sql.json({ a: 1 }) }`, 'select $1', [{ a: 1 }]],
  ['Typed parameter', sql => sql`select ${ sql.typed(1, 23) }`, 'select $1', [1]],

  [
    'Keyword: earlier in( then in',
    sql => sql`select x where x in(select x where x in ${ sql([1, 2]) })`,
    'select x where x in(select x where x in ($1,$2))', [1, 2]
  ],
  [
    'Keyword: in at the end of the string',
    sql => sql`select x where x in (select x where x in${ sql([1, 2]) })`,
    'select x where x in (select x where x in($1,$2))', [1, 2]
  ],
  [
    'Keyword: nested and all spaced',
    sql => sql`select x where x in (select x where x in ${ sql([1, 2]) })`,
    'select x where x in (select x where x in ($1,$2))', [1, 2]
  ],
  ['Keyword: single in followed by (', sql => sql`select x where (x,x) in(${ sql([[1, 1]]) })`, 'select x where (x,x) in(($1,$2))', [1, 1]],
  [
    'Keyword: returning after returning(',
    sql => sql`with a as (insert into t values(2) returning(x)) insert into t values(3) returning ${ sql(['x']) }`,
    'with a as (insert into t values(2) returning(x)) insert into t values(3) returning "x"', []
  ],
  [
    'Keyword: spaced first, then in(, then in',
    sql => sql`select x where x in (select x where x in(select x where x in ${ sql([1, 2]) }))`,
    'select x where x in (select x where x in(select x where x in ($1,$2)))', [1, 2]
  ],
  [
    'Keyword: three occurrences and delimiters',
    sql => sql`select x where x in(select x where x in (select x where x in${ sql([1, 2]) }))`,
    'select x where x in(select x where x in (select x where x in($1,$2)))', [1, 2]
  ],
  [
    'Keyword: case insensitive',
    sql => sql`SELECT x WHERE x IN(SELECT x WHERE x IN ${ sql([1, 2]) })`,
    'SELECT x WHERE x IN(SELECT x WHERE x IN ($1,$2))', [1, 2]
  ],
  [
    'Keyword: earlier keyword in a nested fragment',
    sql => sql`select x where x ${ sql`in(select x where x in ${ sql([1, 2]) })` }`,
    'select x where x in(select x where x in ($1,$2))', [1, 2]
  ],
  [
    'Keyword: newline delimited',
    sql => sql`select x where x\nin(select x where x in ${ sql([1, 2]) })`,
    'select x where x\nin(select x where x in ($1,$2))', [1, 2]
  ],
  [
    'Keyword: identical ( delimiters (control)',
    sql => sql`select x where x in(select x where (x,x) in(${ sql([[1, 1]]) }))`,
    'select x where x in(select x where (x,x) in(($1,$2)))', [1, 1]
  ],
  ['Keyword: empty array', sql => sql`select x where x in(select x where x in ${ sql([]) })`, 'select x where x in(select x where x in (null))', []],
  [
    'Insert with text after',
    sql => sql`insert into x ${ sql({ a: 1 }) } on conflict do nothing`,
    'insert into x ("a")values($1) on conflict do nothing', [1]
  ],
  ['Keyword: no keyword escapes identifiers', sql => sql`select 1 from ${ sql(['a', 'b']) }`, 'select 1 from "a","b"', []],
  [
    'GRANT UPDATE ON a list of tables is identifiers (#1101)',
    sql => sql`grant update on ${ sql(['s.a', 's.b']) } to ${ sql('r') }`,
    'grant update on "s"."a","s"."b" to "r"',
    []
  ],
  ['Update with a table alias (#974)', sql => sql`update foo as f set ${ sql({ bar: sql`now()` }, ['bar']) }`, 'update foo as f set "bar"=now()', []],
  ['Rows in parentheses after in (#820)', sql => sql`select 1 where (a, b) in (${ sql([[1, 2]]) })`, 'select 1 where (a, b) in (($1,$2))', [1, 2]],
  [
    'Insert with a table alias (#774, #517)',
    sql => sql`insert into t as x ${ sql({ a: 1 }) } returning x`,
    'insert into t as x ("a")values($1) returning x',
    [1]
  ],
  [
    'Insert into a schema table with a column list for insert select (#769)',
    sql => sql`insert into "s"."t" ${ sql(['a', 'b']) } select a, b from u`,
    'insert into "s"."t" ("a","b") select a, b from u',
    []
  ],
  [
    'Values of objects with picked columns (#1073)',
    sql => sql`select * from (values ${ sql([{ a: 1, b: 2 }, { a: 3, b: 4 }], 'a', 'b') }) as v (a, b)`,
    'select * from (values ($1,$2),($3,$4)) as v (a, b)',
    [1, 2, 3, 4]
  ],
  [
    'Values of objects in a fragment (#1042)',
    sql => sql`merge into t using (${ sql`values ${ sql([{ a: 1 }, { a: 2 }]) }` }) as v (a) on true when matched then do nothing`,
    'merge into t using (values ($1),($2)) as v (a) on true when matched then do nothing',
    [1, 2]
  ],
  ['Columns mixed with fragments (#777)', sql => sql`select ${ sql(['a', sql`b as c`]) } from t`, 'select "a",b as c from t', []],
  [
    'Two values CTEs (#1149)',
    sql => sql`with a(x, y) as (values (${ 1 }, ${ 2 })), b(n) as (values ${ sql([['p'], ['q']]) }) select 1`,
    'with a(x, y) as (values ($1, $2)), b(n) as (values ($3),($4)) select 1',
    [1, 2, 'p', 'q']
  ],
  [
    'Insert select from values in a CTE (#913)',
    sql => sql`with t as (insert into i default values returning id) insert into r (id, l) select id, l from t join (values ${ sql([['en']]) }) v(l)`,
    'with t as (insert into i default values returning id) insert into r (id, l) select id, l from t join (values ($1)) v(l)',
    ['en']
  ],
  [
    'Update set after a where in a CTE uses update',
    sql => sql`with x as (select 1 where y in (1)) update t set ${ sql({ a: 1 }) }`,
    'with x as (select 1 where y in (1)) update t set "a"=$1',
    [1]
  ],
  [
    'Select columns after a quoted literal containing a keyword',
    sql => sql`select 'in values' as q, ${ sql(['a']) } from t`,
    'select \'in values\' as q, "a" from t',
    []
  ],
  ['Named arguments in a function call (#1040)', sql => sql`select f(${ sql({ a: 1, b: 2 }) })`, 'select f("a" => $1,"b" => $2)', [1, 2]],
  ['Named arguments with picked keys', sql => sql`select s.f(${ sql({ a: 1, b: 2 }, 'b') })`, 'select s.f("b" => $1)', [2]],
  ['Named arguments for a quoted function name', sql => sql`select "F"(${ sql({ a: 1 }) })`, 'select "F"("a" => $1)', [1]],
  ['Columns in a function call stay identifiers', sql => sql`select coalesce(${ sql(['a', 'b']) }) from t`, 'select coalesce("a","b") from t', []],
  [
    'Join fragments with a separator, leaving out falsy items (#807)',
    sql => sql`select * from t where ${ sql`and`.join([sql`a = ${ 1 }`, false, null, sql`b = ${ 2 }`, undefined]) }`,
    'select * from t where a = $1 and b = $2',
    [1, 2]
  ],
  ['Join values as parameters', sql => sql`select x where y in (${ sql`,`.join([1, 2, 3]) })`, 'select x where y in ( $1 , $2 , $3 )', [1, 2, 3]],
  ['Join adds no space where there is one', sql => sql`select ${ sql`, `.join([sql`a `, sql`b`]) }from t`, 'select a , b from t', []],
  ['Join of nothing is empty', sql => sql`select 1 ${ sql`and`.join([false]) }`, 'select 1 ', []],
  ['Join with helpers among the items', sql => sql`select ${ sql`,`.join([sql(['a', 'b']), sql`c`]) } from t`, 'select "a","b" , c from t', []]
]
