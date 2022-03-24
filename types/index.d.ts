/**
 * Establish a connection to a PostgreSQL server.
 * @param options Connection options - default to the same as psql
 * @returns An utility function to make queries to the server
 */
declare function postgres<T extends JSToPostgresTypeMap>(options?: postgres.Options<T>): postgres.Sql<JSToPostgresTypeMap extends T ? {} : T>
/**
 * Establish a connection to a PostgreSQL server.
 * @param url Connection string used for authentication
 * @param options Connection options - default to the same as psql
 * @returns An utility function to make queries to the server
 */
declare function postgres<T extends JSToPostgresTypeMap>(url: string, options?: postgres.Options<T>): postgres.Sql<JSToPostgresTypeMap extends T ? {} : T>

/**
 * Connection options of Postgres.
 */
interface BaseOptions<T extends JSToPostgresTypeMap> {
  /** Postgres ip address[s] or domain name[s] */
  host: string | string[];
  /** Postgres server[s] port[s] */
  port: number | number[];
  /** unix socket path (usually '/tmp') */
  path: string | undefined;
  /**
   * Name of database to connect to
   * @default process.env['PGDATABASE'] || options.user
   */
  database: string;
  /**
   * Username of database user
   * @default process.env['PGUSERNAME'] || process.env['PGUSER'] || require('os').userInfo().username
   */
  user: string;
  /**
   * true, prefer, require or tls.connect options
   * @default false
  */
  ssl: 'require' | 'allow' | 'prefer' | boolean | object;
  /**
   * Max number of connections
   * @default 10
   */
  max: number;
  /**
   * Idle connection timeout in seconds
   * @default process.env['PGIDLE_TIMEOUT']
   */
  idle_timeout: number | undefined;
  /**
   * Connect timeout in seconds
   * @default process.env['PGCONNECT_TIMEOUT']
   */
  connect_timeout: number;
  /** Array of custom types; see more below */
  types: PostgresTypeList<T>;
  /**
   * Enables prepare mode.
   * @default true
   */
  prepare: boolean;
  /**
   * Called when a notice is received
   * @default console.log
   */
  onnotice: (notice: postgres.Notice) => void;
  /** (key; value) when a server param change */
  onparameter: (key: string, value: any) => void;
  /** Is called with (connection; query; parameters) */
  debug: boolean | ((connection: number, query: string, parameters: any[]) => void);
  /** Transform hooks */
  transform: {
    /** Transforms incoming and outgoing column names */
    column?: ((column: string) => string) | {
      /** SQL to JS */
      from?: (column: string) => string;
      /** JS to SQL */
      to?: (column: string) => string;
    };
    /** Transforms incoming and outgoing row values */
    value?: ((value: any) => any) | {
      /** SQL to JS */
      from?: (value: unknown) => any;
      // /** JS to SQL */
      // to?: (value: unknown) => any; // unused
    };
    /** Transforms entire rows */
    row?: ((row: postgres.Row) => any) | {
      /** SQL to JS */
      from?: (row: postgres.Row) => any;
      // /** JS to SQL */
      // to?: (row: postgres.Row) => any; // unused
    };
  };
  /** Connection parameters */
  connection: Partial<postgres.ConnectionParameters>;
  /**
   * Use 'read-write' with multiple hosts to ensure only connecting to primary
   * @default process.env['PGTARGETSESSIONATTRS']
   */
  target_session_attrs: undefined | 'read-write' | 'read-only' | 'primary' | 'standby' | 'prefer-standby';
  /**
   * Automatically fetches types on connect
   * @default true
   */
  fetch_types: boolean;
  /**
   * Publications to subscribe to (only relevant when calling `sql.subscribe()`)
   * @default 'alltables'
   */
  publications: string
}

type PostgresTypeList<T> = {
  [name in keyof T]: T[name] extends (...args: any) => postgres.SerializableParameter
  ? postgres.PostgresType<T[name]>
  : postgres.PostgresType<(...args: any) => postgres.SerializableParameter>;
};

interface JSToPostgresTypeMap {
  [name: string]: unknown;
}

declare const PRIVATE: unique symbol;

declare class NotAPromise {
  private [PRIVATE]: never; // prevent user-side interface implementation

  /**
   * @deprecated This object isn't an SQL query, and therefore not a Promise; use the tagged template string syntax instead: ```await sql\`...\`;```
   * @throws NOT_TAGGED_CALL
   */
  private then(): never;
  /**
   * @deprecated This object isn't an SQL query, and therefore not a Promise; use the tagged template string syntax instead: ```await sql\`...\`;```
   * @throws NOT_TAGGED_CALL
   */
  private catch(): never;
  /**
   * @deprecated This object isn't an SQL query, and therefore not a Promise; use the tagged template string syntax instead: ```await sql\`...\`;```
   * @throws NOT_TAGGED_CALL
   */
  private finally(): never;
}

type UnwrapPromiseArray<T> = T extends any[] ? {
  [k in keyof T]: T[k] extends Promise<infer R> ? R : T[k]
} : T;

declare namespace postgres {
  class PostgresError extends Error {
    name: 'PostgresError';
    severity_local: string;
    severity: string;
    code: string;
    position: string;
    file: string;
    line: string;
    routine: string;

    detail?: string;
    hint?: string;
    internal_position?: string;
    internal_query?: string;
    where?: string;
    schema_name?: string;
    table_name?: string;
    column_name?: string;
    data?: string;
    type_name?: string;
    constraint_name?: string;

    /** Only set when debug is enabled */
    query: string;
    /** Only set when debug is enabled */
    parameters: any[];

    // Disable user-side creation of PostgresError
    private constructor();
  }

  /**
   * Convert a snake_case string to PascalCase.
   * @param str The string from snake_case to convert
   * @returns The new string in PascalCase
   */
  function toPascal(str: string): string;
  /**
   * Convert a PascalCase string to snake_case.
   * @param str The string from snake_case to convert
   * @returns The new string in snake_case
   */
  function fromPascal(str: string): string;
  /**
   * Convert a snake_case string to camelCase.
   * @param str The string from snake_case to convert
   * @returns The new string in camelCase
   */
  function toCamel(str: string): string;
  /**
   * Convert a camelCase string to snake_case.
   * @param str The string from snake_case to convert
   * @returns The new string in snake_case
   */
  function fromCamel(str: string): string;
  /**
   * Convert a snake_case string to kebab-case.
   * @param str The string from snake_case to convert
   * @returns The new string in kebab-case
   */
  function toKebab(str: string): string;
  /**
   * Convert a kebab-case string to snake_case.
   * @param str The string from snake_case to convert
   * @returns The new string in snake_case
   */
  function fromKebab(str: string): string;

  const BigInt: PostgresType<(number: bigint) => string>;

  interface PostgresType<T extends (...args: any[]) => unknown> {
    to: number;
    from: number[];
    serialize: T;
    parse: (raw: string) => unknown;
  }

  interface ConnectionParameters {
    /**
     * Default application_name
     * @default 'postgres.js'
     */
    application_name: string;
    /** Other connection parameters */
    [name: string]: string;
  }

  interface Options<T extends JSToPostgresTypeMap> extends Partial<BaseOptions<T>> {
    /** @inheritdoc */
    host?: string;
    /** @inheritdoc */
    port?: number;
    /** @inheritdoc */
    path?: string;
    /** Password of database user (an alias for `password`) */
    pass?: Options<T>['password'];
    /**
     * Password of database user
     * @default process.env['PGPASSWORD']
     */
    password?: string | (() => string | Promise<string>);
    /** Name of database to connect to (an alias for `database`) */
    db?: Options<T>['database'];
    /** Username of database user (an alias for `user`) */
    username?: Options<T>['user'];
    /** Postgres ip address or domain name (an alias for `host`) */
    hostname?: Options<T>['host'];
    /**
     * Disable prepared mode
     * @deprecated use "prepare" option instead
     */
    no_prepare?: boolean;
    /**
     * Idle connection timeout in seconds
     * @deprecated use "idle_timeout" option instead
     */
    timeout?: Options<T>['idle_timeout'];
  }

  interface ParsedOptions<T extends JSToPostgresTypeMap> extends BaseOptions<T> {
    /** @inheritdoc */
    host: string[];
    /** @inheritdoc */
    port: number[];
    /** @inheritdoc */
    pass: null;
    /** @inheritdoc */
    transform: Transform;
    serializers: Record<number, (...args: any) => SerializableParameter>;
    parsers: Record<number, (value: string) => unknown>;
  }

  interface Transform {
    /** Transforms incoming column names */
    column: {
      from: ((column: string) => string) | undefined;
      to: ((column: string) => string) | undefined;
    };
    /** Transforms incoming row values */
    value: {
      from: ((value: any) => any) | undefined;
      to: undefined; // (value: any) => any
    };
    /** Transforms entire rows */
    row: {
      from: ((row: postgres.Row) => any) | undefined;
      to: undefined; // (row: postgres.Row) => any
    };
  }

  interface Notice {
    [field: string]: string;
  }

  interface Parameter<T = SerializableParameter> extends NotAPromise {
    /**
     * PostgreSQL OID of the type
     */
    type: number;
    /**
     * Serialized value
     */
    value: string | null;
    /**
     * Raw value to serialize
     */
    raw: T | null;
  }

  interface ArrayParameter<T extends SerializableParameter[] = SerializableParameter[]> extends Parameter<T | T[]> {
    array: true;
  }

  interface ConnectionError extends globalThis.Error {
    code:
    | 'CONNECTION_DESTROYED'
    | 'CONNECT_TIMEOUT'
    | 'CONNECTION_CLOSED'
    | 'CONNECTION_ENDED';
    errno: this['code'];
    address: string;
    port?: number;
  }

  interface NotSupportedError extends globalThis.Error {
    code: 'MESSAGE_NOT_SUPPORTED';
    name: string;
  }

  interface GenericError extends globalThis.Error {
    code:
    | '57014' // canceling statement due to user request
    | 'NOT_TAGGED_CALL'
    | 'UNDEFINED_VALUE'
    | 'MAX_PARAMETERS_EXCEEDED'
    | 'SASL_SIGNATURE_MISMATCH';
    message: string;
  }

  interface AuthNotImplementedError extends globalThis.Error {
    code: 'AUTH_TYPE_NOT_IMPLEMENTED';
    type: number | string;
    message: string;
  }

  type Error = never
    | PostgresError
    | ConnectionError
    | NotSupportedError
    | GenericError
    | AuthNotImplementedError;

  interface ColumnInfo {
    key: number;
    name: string;
    type: number;
    parser?(raw: string): unknown;
    atttypmod: number;
  }

  interface RelationInfo {
    schema: string;
    table: string;
    columns: ColumnInfo[];
    keys: ColumnInfo[];
  }

  type ReplicationEvent =
    | { command: 'insert', relation: RelationInfo }
    | { command: 'delete', relation: RelationInfo, key: boolean }
    | { command: 'update', relation: RelationInfo, key: boolean, old: Row | null };

  interface SubscriptionHandle {
    unsubscribe(): void;
  }

  interface LargeObject {
    writable(options?: {
      highWaterMark?: number,
      start?: number
    }): Promise<import('node:stream').Writable>;
    readable(options?: {
      highWaterMark?: number,
      start?: number,
      end?: number
    }): Promise<import('node:stream').Readable>;

    close(): Promise<void>;
    tell(): Promise<void>;
    read(size: number): Promise<void>;
    write(buffer: Uint8Array): Promise<[{ data: Uint8Array }]>;
    truncate(size: number): Promise<void>;
    seek(offset: number, whence?: number): Promise<void>;
    size(): Promise<[{ position: bigint, size: bigint }]>;
  }

  type Serializable = null
    | boolean
    | number
    | string
    | Date
    | Uint8Array;

  type SerializableParameter = Serializable
    | Helper<any>
    | Parameter<any>
    | ArrayParameter
    | Record<string, any> // implicit JSON
    | readonly SerializableParameter[];

  type HelperSerializable = { [index: string]: SerializableParameter } | { [index: string]: SerializableParameter }[];

  type SerializableKeys<T> = (keyof T) extends infer R
    ? R extends keyof T
    ? T[R] extends SerializableParameter
    ? R
    : never
    : keyof T
    : keyof T;

  interface Row {
    [column: string]: any;
  }

  type MaybeRow = Row | undefined;

  type TransformRow<T> = T extends Serializable
    ? { '?column?': T; }
    : T;

  type AsRowList<T extends readonly any[]> = { [k in keyof T]: TransformRow<T[k]> };

  interface Column<T extends string> {
    name: T;
    type: number;
    parser?(raw: string): unknown;
  }

  type ColumnList<T> = (T extends string ? Column<T> : never)[];

  interface State {
    status: string;
    pid: number;
    secret: number;
  }

  interface Statement {
    /** statement unique name */
    name: string;
    /** sql query */
    string: string;
    /** parameters types */
    types: number[];
    columns: ColumnList<string>;
  }

  interface ResultMeta<T extends number | null> {
    count: T; // For tuples
    command: string;
    statement: Statement;
    state: State;
  }

  interface ResultQueryMeta<T extends number | null, U> extends ResultMeta<T> {
    columns: ColumnList<U>;
  }

  type ExecutionResult<T> = [] & ResultQueryMeta<number, keyof NonNullable<T>>;
  type RawRowList<T extends readonly any[]> = Buffer[][] & Iterable<Buffer[][]> & ResultQueryMeta<T['length'], keyof T[number]>;
  type RowList<T extends readonly any[]> = T & Iterable<NonNullable<T[number]>> & ResultQueryMeta<T['length'], keyof T[number]>;

  interface PendingQueryModifiers<TRow extends readonly any[]> {
    readable(): import('node:stream').Readable;
    writable(): import('node:stream').Writable;

    execute(): this;
    cancel(): void;

    /**
     * @deprecated `.stream` has been renamed to `.forEach`
     * @throws
     */
    stream(cb: (row: NonNullable<TRow[number]>, result: ExecutionResult<TRow[number]>) => void): never;
    forEach(cb: (row: NonNullable<TRow[number]>, result: ExecutionResult<TRow[number]>) => void): Promise<ExecutionResult<TRow[number]>>;

    cursor(rows?: number): AsyncIterable<NonNullable<TRow[number]>[]>;
    cursor(cb: (row: [NonNullable<TRow[number]>]) => void): Promise<ExecutionResult<TRow[number]>>;
    cursor(rows: number, cb: (rows: NonNullable<TRow[number]>[]) => void): Promise<ExecutionResult<TRow[number]>>;
  }

  interface PendingDescribeQuery extends Promise<Statement> {
  }

  interface PendingRawQuery<TRow extends readonly MaybeRow[]> extends Promise<RawRowList<TRow>>, PendingQueryModifiers<Buffer[][]> {
  }

  interface PendingQuery<TRow extends readonly MaybeRow[]> extends Promise<RowList<TRow>>, PendingQueryModifiers<TRow> {
    describe(): PendingDescribeQuery;
    raw(): PendingRawQuery<TRow>;
  }

  interface PendingRequest extends Promise<[] & ResultMeta<null>> { }

  interface ListenRequest extends Promise<ListenMeta> { }
  interface ListenMeta extends ResultMeta<null> {
    unlisten(): Promise<void>
  }

  interface Helper<T, U extends any[] = T[]> extends NotAPromise {
    first: T;
    rest: U;
  }

  interface Sql<TTypes extends JSToPostgresTypeMap> {

    /**
     * Execute the SQL query passed as a template string. Can only be used as template string tag.
     * @param template The template generated from the template string
     * @param args Interpoled values of the template string
     * @returns A promise resolving to the result of your query
     */
    <T extends readonly any[] = Row[]>(template: TemplateStringsArray, ...args: SerializableParameter[]): PendingQuery<AsRowList<T>>;

    /**
     * Escape column names
     * @param columns Columns to escape
     * @returns A formated representation of the column names
     */
    (columns: string[]): Helper<string>;
    (...columns: string[]): Helper<string>;

    /**
     * Extract properties from an object or from an array of objects
     * @param objOrArray An object or an array of objects to extract properties from
     * @param keys Keys to extract from the object or from objets inside the array
     * @returns A formated representation of the parameter
     */
    <T extends object | readonly object[], U extends SerializableKeys<T extends readonly object[] ? T[number] : T>>(objOrArray: T, ...keys: U[]): Helper<T, U[]>;

    CLOSE: {};
    END: this['CLOSE'];
    PostgresError: typeof PostgresError;

    options: ParsedOptions<TTypes>;
    parameters: ConnectionParameters;
    types: {
      [name in keyof TTypes]: TTypes[name] extends (...args: any) => any
      ? (...args: Parameters<TTypes[name]>) => postgres.Parameter<ReturnType<TTypes[name]>>
      : (...args: any) => postgres.Parameter<any>;
    };

    unsafe<T extends any[] = (Row & Iterable<Row>)[]>(query: string, parameters?: SerializableParameter[], queryOptions?: UnsafeQueryOptions): PendingQuery<AsRowList<T>>;
    end(options?: { timeout?: number }): Promise<void>;

    listen(channel: string, cb: (value: string) => void): ListenRequest;
    notify(channel: string, payload: string): PendingRequest;

    subscribe(event: string, cb: (row: Row | null, info: ReplicationEvent) => void): Promise<SubscriptionHandle>;

    largeObject(oid?: number, /** @default 0x00020000 | 0x00040000 */ mode?: number): Promise<LargeObject>;

    begin<T>(cb: (sql: TransactionSql<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>;
    begin<T>(options: string, cb: (sql: TransactionSql<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>;

    array<T extends SerializableParameter[] = SerializableParameter[]>(value: T, type?: number): ArrayParameter<T>;
    file<T extends readonly any[] = Row[]>(path: string | Buffer | URL | number, options?: { cache?: boolean }): PendingQuery<AsRowList<T>>;
    file<T extends readonly any[] = Row[]>(path: string | Buffer | URL | number, args: SerializableParameter[], options?: { cache?: boolean }): PendingQuery<AsRowList<T>>;
    json(value: any): Parameter;
  }

  interface UnsafeQueryOptions {
    /**
     * When executes query as prepared statement.
     * @default false
     */
    prepare?: boolean;
  }

  interface TransactionSql<TTypes extends JSToPostgresTypeMap> extends Sql<TTypes> {
    savepoint<T>(cb: (sql: TransactionSql<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>;
    savepoint<T>(name: string, cb: (sql: TransactionSql<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>;
  }
}

export = postgres;
