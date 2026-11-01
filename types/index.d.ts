import type { Readable, Writable } from 'node:stream'
import type { ConnectionOptions as TlsOptions } from 'node:tls'

type ParsedTypes<T extends Record<string, postgres.PostgresType>> =
  Record<string, postgres.PostgresType> extends T
    ? {}
    : { [K in keyof T]: T[K] extends postgres.PostgresType<infer R> ? R : never }

declare function postgres<T extends Record<string, postgres.PostgresType> = {}>(
  options?: postgres.Options<T>
): postgres.Sql<ParsedTypes<T>>
declare function postgres<T extends Record<string, postgres.PostgresType> = {}>(
  url: string,
  options?: postgres.Options<T>
): postgres.Sql<ParsedTypes<T>>

declare const PRIVATE: unique symbol

declare class NotAPromise {
  private [PRIVATE]: never
  /** @deprecated Not a query, and so not a promise: use the tagged template, ```await sql`...` ``` */
  private then(): never
  /** @deprecated Not a query, and so not a promise: use the tagged template, ```await sql`...` ``` */
  private catch(): never
  /** @deprecated Not a query, and so not a promise: use the tagged template, ```await sql`...` ``` */
  private finally(): never
}

type UnwrapPromiseArray<T> = T extends readonly any[]
  ? { -readonly [K in keyof T]: Awaited<T[K]> }
  : T

type Keys = string

type SerializableObject<T, K extends readonly any[], TT> =
  number extends K['length']
    ? {}
    : Partial<
      Record<Keys & keyof T & (K['length'] extends 0 ? string : K[number]), postgres.ParameterOrJSON<TT> | undefined>
      & Record<string, any>
    >

type First<T, K extends readonly any[], TT> =
  T extends TemplateStringsArray ? TemplateStringsArray :
  T extends string ? string :
  T extends readonly any[][] ? readonly postgres.EscapableArray[] :
  T extends readonly (object & infer R)[]
    ? R extends postgres.SerializableParameter<TT>
      ? readonly postgres.SerializableParameter<TT>[]
      : readonly SerializableObject<R, K, TT>[]
    : T extends readonly any[] ? readonly postgres.SerializableParameter<TT>[] :
  T extends object ? SerializableObject<T, K, TT> :
  never

type Rest<T> =
  T extends TemplateStringsArray ? never :
  T extends string ? readonly string[] :
  T extends readonly any[][] ? readonly [] :
  T extends readonly (object & infer R)[]
    ? readonly (Keys & keyof R)[] | [readonly (Keys & keyof R)[]] | [readonly string[]]
    : T extends readonly any[] ? readonly [] :
  T extends object ? readonly (Keys & keyof T)[] | [readonly (Keys & keyof T)[]] | [readonly string[]] :
  any

type Return<T, K extends readonly any[]> =
  [T] extends [TemplateStringsArray]
    ? [unknown] extends [T]
      ? postgres.Helper<T, K>
      : [TemplateStringsArray] extends [T] ? postgres.PendingQuery<postgres.Row[]> : postgres.Helper<T, K>
    : postgres.Helper<T, K>

declare namespace postgres {
  /** An error the server sent */
  class PostgresError extends globalThis.Error {
    constructor(message?: string | Partial<PostgresError>)
    name: 'PostgresError'
    severity_local: string
    severity: string
    code: string
    position: string
    file: string
    line: string
    routine: string

    detail?: string | undefined
    hint?: string | undefined
    internal_position?: string | undefined
    internal_query?: string | undefined
    where?: string | undefined
    schema_name?: string | undefined
    table_name?: string | undefined
    column_name?: string | undefined
    data?: string | undefined
    data_type_name?: string | undefined
    constraint_name?: string | undefined

    /** The text of the query, when the query is known */
    query: string
    /** The parameters of the query; only with `debug` */
    parameters: any[]
    /** The types of the parameters; only with `debug` */
    types?: number[] | undefined
  }

  /** snake_case to PascalCase */
  function toPascal(str: string): string
  namespace toPascal {
    namespace column { function from(str: string): string }
    namespace value { function from(str: unknown, column: Column<string>): string }
  }
  /** PascalCase to snake_case */
  function fromPascal(str: string): string
  namespace fromPascal {
    namespace column { function to(str: string): string }
  }
  /** snake_case to and from PascalCase, as a transform */
  namespace pascal {
    namespace column {
      function from(str: string): string
      function to(str: string): string
    }
    namespace value { function from(str: unknown, column: Column<string>): string }
  }
  /** snake_case to camelCase */
  function toCamel(str: string): string
  namespace toCamel {
    namespace column { function from(str: string): string }
    namespace value { function from(str: unknown, column: Column<string>): string }
  }
  /** camelCase to snake_case */
  function fromCamel(str: string): string
  namespace fromCamel {
    namespace column { function to(str: string): string }
  }
  /** snake_case to and from camelCase, as a transform */
  namespace camel {
    namespace column {
      function from(str: string): string
      function to(str: string): string
    }
    namespace value { function from(str: unknown, column: Column<string>): string }
  }
  /** snake_case to kebab-case */
  function toKebab(str: string): string
  namespace toKebab {
    namespace column { function from(str: string): string }
    namespace value { function from(str: unknown, column: Column<string>): string }
  }
  /** kebab-case to snake_case */
  function fromKebab(str: string): string
  namespace fromKebab {
    namespace column { function to(str: string): string }
  }
  /** snake_case to and from kebab-case, as a transform */
  namespace kebab {
    namespace column {
      function from(str: string): string
      function to(str: string): string
    }
    namespace value { function from(str: unknown, column: Column<string>): string }
  }

  /** int8 as bigint: `types: { bigint: postgres.BigInt }` */
  const BigInt: PostgresType<bigint>

  interface PostgresType<T = any> {
    /** The oid values of this type are sent as, or the type's name, looked up when the pool starts */
    to: number | string
    /** The oids or type names parsed with `parse` */
    from: (number | string)[]
    serialize: (value: T) => unknown
    parse: (raw: any) => T
  }

  interface ConnectionParameters {
    /** @default 'postgres.js' */
    application_name: string
    default_transaction_isolation: 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable'
    default_transaction_read_only: boolean
    default_transaction_deferrable: boolean
    statement_timeout: number
    lock_timeout: number
    idle_in_transaction_session_timeout: number
    idle_session_timeout: number
    DateStyle: string
    IntervalStyle: string
    TimeZone: string
    [name: string]: string | number | boolean
  }

  type SSL = boolean | 'require' | 'allow' | 'prefer' | 'verify-full' | 'disable' | TlsOptions

  /** A socket of your own: anything with the events and methods of a net.Socket that are used */
  interface SocketLike {
    write(data: Uint8Array): boolean
    end(data?: Uint8Array): unknown
    destroy(error?: Error): unknown
    pause(): unknown
    resume(): unknown
    on(event: 'data', fn: (data: Uint8Array) => void): unknown
    on(event: 'drain' | 'close', fn: () => void): unknown
    on(event: 'error', fn: (error: Error) => void): unknown
    off(event: string, fn: (...args: any[]) => void): unknown
    setKeepAlive?(enable: boolean, delay: number): unknown
    /** Set when the socket did the TLS negotiation itself, so it is not done again */
    negotiated?: boolean
    secure?: boolean
  }

  interface Options<T extends Record<string, PostgresType> = {}> {
    /** Host or hosts, with `host:port` allowed; tried in order @default process.env.PGHOST || 'localhost' */
    host?: string | string[] | undefined
    /** An alias for `host` */
    hostname?: string | string[] | undefined
    /** @default process.env.PGPORT || 5432 */
    port?: number | number[] | undefined
    /** A unix socket directory, like '/tmp' */
    path?: string | undefined
    /** @default process.env.PGDATABASE || user */
    database?: string | undefined
    /** An alias for `database` */
    db?: string | undefined
    /** A string, or a function giving one each time a connection opens @default process.env.PGUSERNAME || process.env.PGUSER || os.userInfo().username */
    user?: string | (() => string | Promise<string>) | undefined
    /** An alias for `user` */
    username?: string | (() => string | Promise<string>) | undefined
    /** A string, or a function giving one each time a connection opens @default process.env.PGPASSWORD, then PGPASSFILE or ~/.pgpass */
    password?: string | (() => string | Promise<string>) | undefined
    /** An alias for `password` */
    pass?: string | (() => string | Promise<string>) | undefined

    /**
     * TLS: false, a mode as in libpq's sslmode, or options for tls.connect.
     * 'require', 'allow' and 'prefer' do not verify the certificate; Cloudflare Workers always do.
     * @default false
     */
    ssl?: SSL | undefined
    /**
     * 'direct' starts TLS on the first byte instead of asking first (PostgreSQL 17 and later).
     * On Node it is also the fastest TLS, as it reads into the shared buffer.
     * @default 'postgres'
     */
    sslnegotiation?: 'postgres' | 'direct' | null | undefined

    /**
     * SCRAM-SHA-256-PLUS over TLS, binding the login to the server certificate, as libpq's channel_binding.
     * 'require' rejects a connection that can not be bound with CHANNEL_BINDING_REQUIRED.
     * @default 'prefer'
     */
    channel_binding?: 'disable' | 'prefer' | 'require' | undefined

    /** Most connections at a time @default 10 */
    max?: number | undefined
    /** Connections kept open once the pool is used, even when idle @default 0 */
    min?: number | undefined
    /** Most queries pipelined on one connection @default 100 */
    max_pipeline?: number | undefined
    /**
     * Pipeline a query on the busy connection where it should be done soonest, keeping slow queries together
     * so quick ones don't wait behind them; false pipelines on the connection with fewest queries in flight
     * @default true
     */
    scheduler?: boolean | undefined
    /** Seconds before an idle connection closes; 0, null or false to keep it @default null */
    idle_timeout?: number | null | false | undefined
    /** Seconds a query, transaction or reserve may wait for a connection before QUEUE_TIMEOUT; 0 to wait as long as it takes @default 0 */
    queue_timeout?: number | undefined
    /** Seconds to connect before CONNECT_TIMEOUT; 0, null or false to wait as long as it takes @default 30 */
    connect_timeout?: number | null | false | undefined
    /**
     * Seconds a connection waiting for an answer may receive nothing before it is closed with ANSWER_TIMEOUT;
     * not on a reserved connection, nor while a cursor's callback, a COPY upload or a paused reader keeps the server waiting
     * @default null
     */
    answer_timeout?: number | null | undefined
    /** Seconds a connection lives at most; a function gives a number per connection; 0, null or false for no limit @default 30 to 60 minutes */
    max_lifetime?: number | null | false | (() => number) | undefined
    /** Seconds before reconnecting after a failure; a function of the number of attempts @default exponential */
    backoff?: boolean | number | ((attempts: number) => number) | undefined
    /** Seconds of TCP keep-alive; 0 or null for none @default 60 */
    keep_alive?: number | null | false | undefined

    /** Named prepared statements @default true */
    prepare?: boolean | undefined
    /**
     * false leaves every parameter to the server, as libpq does, and writes each value for the type it
     * asks for. true types parameters from their values as v3 did: a Date as timestamptz, a Uint8Array as
     * bytea, a boolean, a bigint as int8 and an array by its first element.
     * @default false
     */
    infer?: boolean | undefined
    /** Fetches array types and the types of columns it does not know @default true */
    fetch_types?: boolean | undefined
    /** Custom types; see the README */
    types?: T | undefined

    /** Called with each notice; false to drop them @default console.log */
    onnotice?: false | ((notice: Notice) => void) | undefined
    /** Called with each notification, whether listened to or not */
    onnotify?: ((channel: string, payload: string, pid: number) => void) | undefined
    /** Called when a server parameter changes */
    onparameter?: ((key: string, value: string) => void) | undefined
    /** Called with the id of each connection that closes */
    onclose?: ((connection: number) => void) | undefined
    /** true, or a function called with every query */
    debug?: boolean | ((connection: number, query: string, parameters: any[], types: number[]) => void) | undefined

    /** Transforms of column names, values and rows */
    transform?: TransformOptions | undefined
    /** Run-time parameters sent at startup */
    connection?: Partial<ConnectionParameters> | undefined
    /** For several hosts: which kind of server to settle on @default process.env.PGTARGETSESSIONATTRS */
    target_session_attrs?: 'read-write' | 'read-only' | 'primary' | 'standby' | 'prefer-standby' | null | undefined

    /** Publications for `sql.subscribe` @default 'alltables' */
    publications?: string | undefined
    /**
     * A permanent replication slot for `sql.subscribe`, created if it does not exist. Streaming starts
     * where the slot was last confirmed, and a transaction is confirmed once its handlers finish.
     * Without one, subscribe uses a temporary slot.
     */
    slot?: string | null | undefined

    /** A socket of your own for each connection */
    socket?: ((options: ParsedOptions, host: string, port: number) => SocketLike | Promise<SocketLike>) | undefined
    /** Reads plain and direct TLS connections into one shared buffer per connection (Node, Bun and Deno) @default true */
    onread?: boolean | undefined
    /** Idle connections do not keep the process alive, so it can exit without sql.end() @default false */
    unref_sockets?: boolean | undefined

    /** @deprecated use `prepare: false` */
    no_prepare?: boolean | undefined
    /** @deprecated use `idle_timeout` */
    timeout?: number | undefined
  }

  interface TransformOptions {
    /** What undefined is sent as, instead of failing with UNDEFINED_VALUE */
    undefined?: any
    column?: ((column: string) => string) | {
      /** Column names in results */
      from?: ((column: string) => string) | undefined
      /** Column names given to helpers */
      to?: ((column: string) => string) | undefined
    } | undefined
    value?: ((value: any) => any) | {
      /** Values in results */
      from?: ((value: unknown, column: Column<string>) => any) | undefined
    } | undefined
    row?: ((row: Row) => any) | {
      /** Whole rows in results */
      from?: ((row: Row) => any) | undefined
    } | undefined
  }

  interface Transform {
    undefined: any
    column: {
      from: ((column: string) => string) | undefined
      to: ((column: string) => string) | undefined
    }
    value: {
      from: ((value: any, column?: Column<string>) => any) | undefined
      to: undefined
    }
    row: {
      from: ((row: Row) => any) | undefined
      to: undefined
    }
  }

  interface ParsedOptions<T extends Record<string, unknown> = {}> {
    host: string[]
    port: number[]
    path: string | false
    database: string | null
    user: string | (() => string | Promise<string>)
    pass: string | (() => string | Promise<string>)
    ssl: SSL
    sslnegotiation: 'postgres' | 'direct' | null
    channel_binding: 'disable' | 'prefer' | 'require'
    max: number
    min: number
    max_pipeline: number
    scheduler: boolean
    idle_timeout: number | null
    connect_timeout: number
    answer_timeout: number | null
    queue_timeout: number
    max_lifetime: number | null | (() => number)
    backoff: boolean | number | ((attempts: number) => number)
    keep_alive: number | null
    prepare: boolean
    infer: boolean
    fetch_types: boolean
    debug: Options['debug']
    publications: string
    slot: string | null
    onread: boolean
    unref_sockets: boolean
    target_session_attrs: Options['target_session_attrs']
    connection: Partial<ConnectionParameters>
    types: { [K in keyof T]: PostgresType<T[K]> }
    transform: Transform
    parameters: Record<string, string>
    serializers: Record<number, (value: any) => unknown>
    parsers: Record<number, (value: any) => unknown>
  }

  interface Notice {
    [field: string]: string
  }

  interface Parameter<T = SerializableParameter> extends NotAPromise {
    /** The oid of the type */
    type: number
    /** The value as sent */
    value: string | null
    /** The value as given */
    raw: T | null
  }

  interface ConnectionError extends globalThis.Error {
    code:
      | 'CONNECTION_DESTROYED'
      | 'CONNECT_TIMEOUT'
      | 'ANSWER_TIMEOUT'
      | 'CONNECTION_CLOSED'
      | 'CONNECTION_ENDED'
    errno: this['code']
    address: string
    port?: number | undefined
  }

  interface NotSupportedError extends globalThis.Error {
    code: 'MESSAGE_NOT_SUPPORTED'
    name: string
  }

  interface GenericError extends globalThis.Error {
    code:
      | '57014'
      | 'NOT_TAGGED_CALL'
      | 'UNDEFINED_VALUE'
      | 'MAX_PARAMETERS_EXCEEDED'
      | 'ARRAY_REMOVED'
      | 'COPY_IN_PROGRESS'
      | 'UNSAFE_TRANSACTION'
      | 'TRANSACTION_ROLLED_BACK'
      | 'SSL_NOT_SUPPORTED'
      | 'CHANNEL_BINDING_REQUIRED'
      | 'PROTOCOL_ERROR'
      | 'NUL_CHARACTER'
      | 'SSL_NEGOTIATION_NOT_SUPPORTED'
      | 'SASL_MECHANISM_NOT_SUPPORTED'
      | 'SASL_NONCE_MISMATCH'
      | 'SASL_SIGNATURE_MISMATCH'
      | 'TLS_HANDSHAKE_FAILED'
      | 'NO_COLUMNS'
      | 'QUEUE_TIMEOUT'
      | 'TYPE_NOT_FOUND'
      | 'NESTED_TRANSACTION_MODE'
    message: string
  }

  interface AuthNotImplementedError extends globalThis.Error {
    code: 'AUTH_TYPE_NOT_IMPLEMENTED'
    message: string
  }

  type Error =
    | PostgresError
    | ConnectionError
    | NotSupportedError
    | GenericError
    | AuthNotImplementedError

  interface ColumnInfo {
    key: number
    name: string
    type: number
    parser?(raw: string): unknown
    atttypmod: number
  }

  interface RelationInfo {
    schema: string
    table: string
    columns: ColumnInfo[]
    keys: ColumnInfo[]
  }

  interface TransactionInfo {
    /** The LSN of the transaction, like '0/1A2B3C4' */
    lsn: string | undefined
    /** When it committed */
    time: Date | undefined
    xid: number | undefined
  }

  type ReplicationEvent = TransactionInfo & (
    | { command: 'insert', relation: RelationInfo }
    | { command: 'update', relation: RelationInfo, key: boolean, old: Row | null }
    | { command: 'delete', relation: RelationInfo, key: boolean }
    | { command: 'truncate', relation: RelationInfo, cascade: boolean, restartIdentity: boolean }
  )

  interface SubscriptionHandle {
    unsubscribe(): void
    state: { pid: number | undefined, secret: number | undefined }
    sql: Sql
  }

  interface LargeObject {
    writable(options?: {
      highWaterMark?: number | undefined
      start?: number | undefined
    }): Promise<Writable>
    readable(options?: {
      highWaterMark?: number | undefined
      start?: number | undefined
      end?: number | undefined
    }): Promise<Readable>

    close(): Promise<void>
    tell(): Promise<void>
    read(size: number): Promise<void>
    write(buffer: Uint8Array): Promise<[{ data: Uint8Array }]>
    truncate(size: number): Promise<void>
    seek(offset: number, whence?: number): Promise<void>
    size(): Promise<[{ position: bigint, size: bigint }]>
  }

  type EscapableArray = readonly (Serializable | Helper<any, readonly any[]> | Parameter<any> | readonly SerializableParameter[])[]

  type Serializable =
    | null
    | boolean
    | number
    | bigint
    | string
    | Date
    | Uint8Array

  type SerializableParameter<T = never> =
    | T
    | Serializable
    | Helper<any, readonly any[]>
    | Parameter<any>
    | readonly SerializableParameter<T>[]

  type JSONValue =
    | null
    | string
    | number
    | boolean
    | Date
    | readonly JSONValue[]
    | { toJSON(): any }
    | { readonly [prop: string | number]: undefined | JSONValue | ((...args: any) => any) }
    | object

  interface Row {
    [column: string]: any
  }

  type MaybeRow = Row | undefined

  interface Column<T extends string> {
    name: T
    type: number
    table: number
    number: number
    parser?: ((raw: string) => unknown) | undefined
  }

  type ColumnList<T> = (T extends string ? Column<T> : never)[]

  interface State {
    status: string
    pid: number
    secret: number
  }

  interface Statement {
    /** The name it is prepared as, '' when unnamed */
    name: string
    /** The text sent */
    string: string
    /** The types of its parameters */
    types: number[]
    columns: ColumnList<string>
  }

  interface ResultMeta<T extends number | null> {
    count: T
    command: string
    statement: Statement
    state: State
  }

  interface ResultQueryMeta<T extends number | null, U> extends ResultMeta<T> {
    columns: ColumnList<U>
  }

  type ExecutionResult<T> = [] & ResultQueryMeta<number, keyof NonNullable<T>>
  type ValuesRowList<T extends readonly any[]> =
    T[number][keyof T[number]][][] & ResultQueryMeta<T['length'], keyof T[number]>
  type RawRowList<T extends readonly any[]> =
    Buffer[][] & Iterable<Buffer[][]> & ResultQueryMeta<T['length'], keyof T[number]>
  type RowList<T extends readonly any[]> =
    T & Iterable<NonNullable<T[number]>> & ResultQueryMeta<T['length'], keyof T[number]>

  interface PendingQueryModifiers<TRow extends readonly any[]> {
    /** Sends it with the simple protocol, which allows several statements */
    simple(): this
    /** For `copy ... to stdout` */
    readable(): Promise<Readable>
    /** For `copy ... from stdin` */
    writable(): Promise<Writable>

    /** Sends it now instead of when awaited */
    execute(): this
    /** Cancels it, sent or not */
    cancel(): Promise<void>
    /** Cancels it when the signal aborts: `.signal(AbortSignal.timeout(5000))` */
    signal(signal: AbortSignal | null | undefined): this

    /** @deprecated renamed to `.forEach` */
    stream(cb: (row: NonNullable<TRow[number]>, result: ExecutionResult<TRow[number]>) => void): never
    /** Calls back with each row as it arrives, instead of collecting them */
    forEach(cb: (row: NonNullable<TRow[number]>, result: ExecutionResult<TRow[number]>) => void): Promise<ExecutionResult<TRow[number]>>

    /** Rows in batches: `for await (const rows of sql`...`.cursor(10))` */
    cursor(rows?: number): AsyncIterable<NonNullable<TRow[number]>[]>
    /** One row at a time; return a promise to wait, or `sql.CLOSE` to stop */
    cursor(cb: (row: [NonNullable<TRow[number]>]) => unknown): Promise<ExecutionResult<TRow[number]>>
    /** Batches of rows; return a promise to wait, or `sql.CLOSE` to stop */
    cursor(rows: number, cb: (rows: NonNullable<TRow[number]>[]) => unknown): Promise<ExecutionResult<TRow[number]>>
  }

  interface PendingDescribeQuery extends Promise<Statement> {}

  interface PendingValuesQuery<TRow extends readonly MaybeRow[]>
    extends Promise<ValuesRowList<TRow>>, PendingQueryModifiers<TRow[number][keyof TRow[number]][][]> {
    describe(): PendingDescribeQuery
  }

  interface PendingRawQuery<TRow extends readonly MaybeRow[]>
    extends Promise<RawRowList<TRow>>, PendingQueryModifiers<Buffer[][]> {}

  interface PendingQuery<TRow extends readonly MaybeRow[]>
    extends Promise<RowList<TRow>>, PendingQueryModifiers<TRow> {
    /** Parses and describes it without running it */
    describe(): PendingDescribeQuery
    /** Rows as arrays of values */
    values(): PendingValuesQuery<TRow>
    /** Rows as arrays of the raw bytes */
    raw(): PendingRawQuery<TRow>
    /** As a separator: ``sql` and `.join(fragments)``; falsy items are left out, and spaces are added where missing */
    join(items: readonly (ParameterOrFragment<any> | false | null | undefined)[]): PendingQuery<Row[]> & { readonly length: number }
    /** The text it will be sent as */
    readonly text: string
    /** The values it will be sent with */
    readonly parameters: any[]
  }

  interface PendingRequest extends Promise<[] & ResultMeta<null>> {}

  interface ListenRequest extends Promise<ListenMeta> {}
  interface ListenMeta {
    state: State
    unlisten(): Promise<void>
  }

  interface Helper<T, U extends readonly any[] = T[]> extends NotAPromise {
    first: T
    rest: U
  }

  type Fragment = PendingQuery<any>

  type ParameterOrJSON<T> =
    | SerializableParameter<T>
    | JSONValue

  type ParameterOrFragment<T> =
    | SerializableParameter<T>
    | Fragment
    | Fragment[]

  interface UnsafeQueryOptions {
    /** As a named prepared statement @default false */
    prepare?: boolean | undefined
    /** With the simple protocol @default true without parameters */
    simple?: boolean | undefined
  }

  /** The context of the `postgres:query` tracing channel */
  interface QueryTrace {
    /** The text sent, with $1, $2 for the parameters */
    query: string | null
    /** The values; only with `debug` */
    parameters: any[] | undefined
    /** The name it is prepared as, '' if unnamed; null until sent */
    statement: string | null
    database: string
    user: string
    connection: number | null
    host: string | null
    port: number | null
    command: string | null
    count: number | null
    /** Times from performance.now() */
    queued: number
    sent: number | null
    firstByte: number | null
    complete: number | null
    result?: unknown
    error?: Error | globalThis.Error
  }

  /** The context of the `postgres:connect` tracing channel */
  interface ConnectTrace {
    host: string | null
    port: number | null
    path: string | null
    database: string
    user: string
    ssl: boolean
    sslnegotiation: 'postgres' | 'direct'
    result?: { pid: number, status: string, readOnly: boolean, standby: boolean }
    error?: Error | globalThis.Error
  }

  /** The context of the `postgres:transaction` tracing channel */
  interface TransactionTrace {
    mode: string
    database: string
    user: string
    connection: number | null
    host: string | null
    port: number | null
    outcome: 'commit' | 'rollback' | 'prepare' | null
    result?: unknown
    error?: Error | globalThis.Error
  }

  /** A message on the `postgres:pool` channel */
  interface PoolEvent {
    event: 'open' | 'idle' | 'wait' | 'lease' | 'release' | 'close'
    connection: number | null
    host: string | null
    port: number | null
    database: string
    stats: PoolStats
    kind?: string
    waited?: number
    waiting?: number
    error?: Error | globalThis.Error
  }

  /** A message on the `postgres:notice` channel */
  interface NoticeEvent {
    notice: Notice
    connection: number
    host: string
    port: number
    database: string
  }

  interface PoolStats {
    connections: number
    opening: number
    idle: number
    leased: number
    waiting: number
  }

  interface ISql<TTypes extends Record<string, unknown> = {}> {
    /**
     * A helper: an identifier, a list of values, or the columns and values of objects
     * @example sql`insert into users ${ sql(user, 'name', 'age') }`
     */
    <T, K extends Rest<T>>(first: T & First<T, K, TTypes[keyof TTypes]>, ...rest: K): Return<T, K>

    /**
     * A query
     * @example const users = await sql<User[]>`select * from users where id = ${ id }`
     */
    <T extends readonly (object | undefined)[] = Row[]>(
      template: TemplateStringsArray,
      ...parameters: readonly ParameterOrFragment<TTypes[keyof TTypes]>[]
    ): PendingQuery<T>

    types: this['typed']
    /** A value with the oid to send it as, or one of the custom types by name */
    typed: (<T>(value: T, oid: number) => Parameter<T>) & {
      [name in keyof TTypes]: (value: TTypes[name]) => Parameter<TTypes[name]>
    }

    /** A query from a string: never with values from users in the string itself */
    unsafe<T extends any[] = (Row & Iterable<Row>)[]>(
      query: string,
      parameters?: ParameterOrJSON<TTypes[keyof TTypes]>[],
      options?: UnsafeQueryOptions
    ): PendingQuery<T>
    unsafe<T extends any[] = (Row & Iterable<Row>)[]>(query: string, options: UnsafeQueryOptions): PendingQuery<T>

    notify(channel: string, payload: string): PendingRequest

    /** @deprecated removed in v4: pass the array as it is, and cast it if needed (`${ xs }::int[]`) */
    array(value: any, type?: number): never

    /** A query from a file */
    file<T extends readonly any[] = Row[]>(path: string | Buffer | URL | number, options?: { cache?: boolean | undefined }): PendingQuery<T>
    file<T extends readonly any[] = Row[]>(
      path: string | Buffer | URL | number,
      args: ParameterOrJSON<TTypes[keyof TTypes]>[],
      options?: { cache?: boolean | undefined }
    ): PendingQuery<T>

    /** A value sent as json */
    json(value: JSONValue): Parameter
  }

  interface Sql<TTypes extends Record<string, unknown> = {}> extends ISql<TTypes> {
    /** Return from a cursor callback to stop it */
    CLOSE: {}
    END: this['CLOSE']
    PostgresError: typeof PostgresError

    options: ParsedOptions<TTypes>
    /** The server's parameters, as last reported */
    parameters: ConnectionParameters
    /** What the pool is doing right now */
    readonly stats: PoolStats

    /** Waits for queries to finish, then closes every connection; queries after it reject */
    end(options?: { timeout?: number | undefined }): Promise<void>
    /** Closes every connection once its queries finish; the pool stays usable */
    close(): Promise<void>

    listen(channel: string, onnotify: (value: string) => void, onlisten?: () => void): ListenRequest

    /**
     * Logical replication. A handler may return a promise: handlers run one after the other, in
     * commit order, and with a `slot` a transaction is confirmed only once they all finish.
     * @param event 'insert', 'update', 'delete', 'truncate' or '*', then optionally ':table' and '=key'
     */
    subscribe(
      event: string,
      cb: (row: Row | null, info: ReplicationEvent, event: string) => unknown,
      onsubscribe?: () => void,
      onerror?: (error: globalThis.Error) => void
    ): Promise<SubscriptionHandle>

    largeObject(oid?: number, /** @default 0x00020000 | 0x00040000 */ mode?: number): Promise<LargeObject>

    begin<T>(cb: (sql: TransactionSql<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>
    begin<T>(options: string, cb: (sql: TransactionSql<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>

    /** A connection of your own until `release()` */
    reserve(): Promise<ReservedSql<TTypes>>

    /** `await using sql = postgres()` ends the pool when it goes out of scope */
    [Symbol.asyncDispose](): Promise<void>
  }

  interface TransactionSql<TTypes extends Record<string, unknown> = {}> extends ISql<TTypes> {
    /** A savepoint; a mode other than the transaction's throws NESTED_TRANSACTION_MODE */
    begin<T>(cb: (sql: TransactionSql<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>
    begin<T>(options: string, cb: (sql: TransactionSql<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>
    savepoint<T>(cb: (sql: TransactionSql<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>
    savepoint<T>(name: string, cb: (sql: TransactionSql<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>

    /** Ends with PREPARE TRANSACTION name instead of COMMIT */
    prepare(name: string): string
    /** Rolls back the transaction, or the savepoint it is called in, at once; later queries are not sent and reject with TRANSACTION_ROLLED_BACK */
    rollback(): Promise<void>
  }

  interface ReservedSql<TTypes extends Record<string, unknown> = {}> extends ISql<TTypes> {
    release(): void
    /** `using reserved = await sql.reserve()` releases it when it goes out of scope */
    [Symbol.dispose](): void
    [Symbol.asyncDispose](): Promise<void>
  }
}

export default postgres

export type Sql<TTypes extends Record<string, unknown> = {}> = postgres.Sql<TTypes>
export type TransactionSql<TTypes extends Record<string, unknown> = {}> = postgres.TransactionSql<TTypes>
export type ReservedSql<TTypes extends Record<string, unknown> = {}> = postgres.ReservedSql<TTypes>
export type Options<T extends Record<string, postgres.PostgresType> = {}> = postgres.Options<T>
export type ParsedOptions<T extends Record<string, unknown> = {}> = postgres.ParsedOptions<T>
export type PendingQuery<T extends readonly postgres.MaybeRow[]> = postgres.PendingQuery<T>
export type RowList<T extends readonly any[]> = postgres.RowList<T>
export type Row = postgres.Row
export type Fragment = postgres.Fragment
export type Helper<T, U extends readonly any[] = T[]> = postgres.Helper<T, U>
export type Parameter<T = postgres.SerializableParameter> = postgres.Parameter<T>
export type PostgresType<T = any> = postgres.PostgresType<T>
export type ReplicationEvent = postgres.ReplicationEvent
export type Notice = postgres.Notice
export declare const PostgresError: typeof postgres.PostgresError
export type PostgresError = postgres.PostgresError
/** What Sql, TransactionSql and ReservedSql have in common: take this to accept any of them */
export type ISql<TTypes extends Record<string, unknown> = {}> = postgres.ISql<TTypes>
export type Error = postgres.Error
export type QueryTrace = postgres.QueryTrace
export type ConnectTrace = postgres.ConnectTrace
export type TransactionTrace = postgres.TransactionTrace
export type PoolEvent = postgres.PoolEvent
export type NoticeEvent = postgres.NoticeEvent
