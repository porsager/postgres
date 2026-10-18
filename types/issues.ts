import postgres, { PostgresError, type ISql, type ReservedSql } from './index.js'

const sql = postgres({ connect_timeout: 0, idle_timeout: null, max_lifetime: null, sslnegotiation: 'postgres' })

async function i1163(db: ISql = sql) { return db`select 1` }
await sql.begin(tx => i1163(tx))

await sql.begin(async tx => {
  await tx`insert into ${ tx('t') } values (${ 1 })`
  await tx`select ${ tx(['a', 'b']) } from t`
})

async function i713(r: ReservedSql) {
  // @ts-expect-error a reserved connection has no begin
  r.begin
  // @ts-expect-error a reserved connection has no end
  r.end
  r.release()
}
void i713

const e703 = new PostgresError('message')
e703.message satisfies string
new PostgresError({ message: 'x', code: '23505' }).code satisfies string
try { await sql`select 1` } catch (e) { if (e instanceof PostgresError) e.code satisfies string }

await sql`select * from (values ${ sql([[1, 2, null, 4]]) }) as v(a, b, c, d)`

const users = [{ name: 'Murray', age: 68, garbage: 'ignore' }, { name: 'Walter', age: 80, garbage: 'x' }]
const [inserted] = await sql<{ id: number }[]>`insert into users ${ sql(users, 'name', 'age') } returning id`
inserted.id satisfies number

interface UpdateCourse { name?: string, price?: number }
async function i916(course: UpdateCourse, keys: string[]) {
  return sql`update courses set ${ sql(course, keys) } where id = 1`
}
void i916

async function i625(contact: object, owner: string) {
  return sql`insert into account (owner, contact) values (${ owner }, ${ sql.json(contact as postgres.JSONValue) })`
}
void i625

class Inner { aProp = 5 }
class Outer { inner = new Inner() }
await sql`insert into t ${ sql(new Outer()) }`

async function one<T extends object>(strings: TemplateStringsArray, ...values: postgres.ParameterOrFragment<never>[]): Promise<T | null> {
  const [row] = await sql<T[]>(strings, ...values)
  return row ?? null
}
const u = await one<{ id: number }>`select 1 as id`
u satisfies { id: number } | null

const user = { name: 'Murray', age: 68 }
// @ts-expect-error a column that is not a key of the object is still caught
await sql`insert into users ${ sql(user, 'nme') }`
// @ts-expect-error a column that is not a key of the objects is still caught
await sql`insert into users ${ sql([user], 'nme') }`
await sql`insert into users ${ sql(user, 'name', 'age') }`

const rotating = postgres({ user: async() => 'u', min: 2, unref_sockets: true })
rotating.options.min satisfies number
await rotating`select make_interval(${ rotating({ days: 1 }) })`
async function disposable() {
  const reserved = await rotating.reserve()
  reserved[Symbol.dispose]()
  await rotating[Symbol.asyncDispose]()
}
void disposable

const named = postgres({ queue_timeout: 5, types: { vector: { to: 'vector', from: ['vector'], serialize: (x: number[]) => '[' + x + ']', parse: (x: string) => JSON.parse(x) as number[] } } })
const where = named` and `.join([named`a = ${ 1 }`, false && named`b = 2`])
where.length satisfies number
await named`select * from t ${ where.length ? named`where ${ where }` : named`` }`.signal(AbortSignal.timeout(1000))
await named.begin(tx => tx.begin(tx => tx`select ${ named.typed.vector([1, 2]) }`))
