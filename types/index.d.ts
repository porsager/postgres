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
  /** Postgres ip address or domain name */
  host: string | string[];
  /** Postgres server port */
  port: number | number[];
  /** Name of database to connect to */
  database: string;
  /** Username of database user */
  user: string;
  /** True; or options for tls.connect */
  ssl: 'require' | 'prefer' | boolean | object;
  /** Max number of connections */
  max: number;
  /** Idle connection timeout in seconds */
  idle_timeout: number | undefined;
  /** Connect timeout in seconds */
  connect_timeout: number;
  /** Array of custom types; see more below */
  types: PostgresTypeList<T>;
  /** Disable prepared mode */
  no_prepare: boolean;
  /** Defaults to console.log */
  onnotice: (notice: postgres.Notice) => void;
  /** (key; value) when server param change */
  onparameter: (key: string, value: any) => void;
  /** Is called with (connection; query; parameters) */
  debug: boolean | ((connection: number, query: string, parameters: any[]) => void);
  /** Transform hooks */
  transform: {
    /** Transforms incoming column names */
    column?: (column: string) => string;
    /** Transforms incoming row values */
    value?: (value: any) => any;
    /** Transforms entire rows */
    row?: (row: postgres.Row) => any;
  };
  /** Connection parameters */
  connection: Partial<postgres.ConnectionParameters>;
}

type PostgresTypeList<T> = {
  [name in keyof T]: T[name] extends (...args: any) => unknown
  ? postgres.PostgresType<T[name]>
  : postgres.PostgresType;
};

interface JSToPostgresTypeMap {
  [name: string]: unknown;
}

declare class PostgresError extends Error {
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

  // Disable user-side creation of PostgresError
  private constructor();
}

type UnwrapPromiseArray<T> = T extends any[] ? {
  [k in keyof T]: T[k] extends Promise<infer R> ? R : T[k]
} : T;

type PostgresErrorType = PostgresError

declare namespace postgres {
  type PostgresError = PostgresErrorType

  /**
   * Convert a string to Pascal case.
   * @param str THe string to convert
   * @returns The new string in Pascal case
   */
  function toPascal(str: string): string;
  /**
   * Convert a string to Camel case.
   * @param str THe string to convert
   * @returns The new string in Camel case
   */
  function toCamel(str: string): string;
  /**
   * Convert a string to Kebab case.
   * @param str THe string to convert
   * @returns The new string in Kebab case
   */
  function toKebab(str: string): string;

  const BigInt: PostgresType<(number: bigint) => string>;

  interface ConnectionParameters {
    /** Default application_name */
    application_name: string;
    /** Other connection parameters */
    [name: string]: any;
  }

  interface Options<T extends JSToPostgresTypeMap> extends Partial<BaseOptions<T>> {
    /** @inheritdoc */
    host?: string;
    /** @inheritdoc */
    port?: number;
    /** unix socket path (usually '/tmp') */
    path?: string | (() => string);
    /** Password of database user (an alias for `password`) */
    pass?: Options<T>['password'];
    /** Password of database user */
    password?: string | (() => string | Promise<string>);
    /** Name of database to connect to (an alias for `database`) */
    db?: Options<T>['database'];
    /** Username of database user (an alias for `username`) */
    username?: Options<T>['user'];
    /** Postgres ip address or domain name (an alias for `host`) */
    hostname?: Options<T>['host'];
  }

  interface ParsedOptions<T extends JSToPostgresTypeMap> extends BaseOptions<T> {
    /** @inheritdoc */
    host: string[];
    /** @inheritdoc */
    port: number[];
    /** @inheritdoc */
    pass: null;
    serializers: { [oid: number]: T[keyof T] };
    parsers: { [oid: number]: T[keyof T] };
  }

  interface Notice {
    [field: string]: string;
  }

  interface PostgresType<T extends (...args: any) => any = (...args: any) => any> {
    to: number;
    from: number[];
    serialize: T;
    parse: (raw: ReturnType<T>) => unknown;
  }

  interface Parameter<T = SerializableParameter> {
    /**
     * PostgreSQL OID of the type
     */
    type: number;
    /**
     * Value to serialize
     */
    value: T;
  }

  interface ArrayParameter<T extends SerializableParameter[] = SerializableParameter[]> extends Parameter<T | T[]> {
    array: true;
  }

  interface ConnectionError extends globalThis.Error {
    code: never
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
    name: never
    | 'CopyInResponse'
    | 'CopyOutResponse'
    | 'ParameterDescription'
    | 'FunctionCallResponse'
    | 'NegotiateProtocolVersion'
    | 'CopyBothResponse';
  }

  interface GenericError extends globalThis.Error {
    code: never
    | 'NOT_TAGGED_CALL'
    | 'UNDEFINED_VALUE'
    | 'MAX_PARAMETERS_EXCEEDED'
    | 'SASL_SIGNATURE_MISMATCH';
    message: string;
  }

  interface AuthNotImplementedError extends globalThis.Error {
    code: 'AUTH_TYPE_NOT_IMPLEMENTED';
    type: number
    | 'KerberosV5'
    | 'CleartextPassword'
    | 'MD5Password'
    | 'SCMCredential'
    | 'GSS'
    | 'GSSContinue'
    | 'SSPI'
    | 'SASL'
    | 'SASLContinue'
    | 'SASLFinal';
    message: string;
  }

  type Error = never
    | PostgresError
    | ConnectionError
    | NotSupportedError
    | GenericError
    | AuthNotImplementedError;

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
    | SerializableParameter[];

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

  interface UnlabeledRow<T = any> {
    '?column?': T;
  }

  type MaybeRow = Row | undefined;

  type TransformRow<T> = T extends Serializable
    ? { '?column?': T; }
    : T;

  type AsRowList<T extends readonly any[]> = { [k in keyof T]: TransformRow<T[k]> };

  interface Column<T extends string> {
    name: T;
    type: number;
    parser(raw: string): string;
  }

  type ColumnList<T> = (T extends string ? Column<T> : never)[];

  interface State {
    state: 'I';
    pid: number;
    secret: number;
  }

  interface ResultMeta<T extends number | null> {
    count: T; // For tuples
    command: string;
    state: State;
  }

  interface ResultQueryMeta<T extends number | null, U> extends ResultMeta<T> {
    columns: ColumnList<U>;
  }

  type ExecutionResult<T> = [] & ResultQueryMeta<number, keyof NonNullable<T>>;
  type RowList<T extends MaybeRow[]> = T & Iterable<NonNullable<T[number]>> & ResultQueryMeta<T['length'], keyof T[number]>;

  interface PendingQuery<TRow extends MaybeRow[]> extends Promise<RowList<TRow>> {
    stream(cb: (row: NonNullable<TRow[number]>, result: ExecutionResult<TRow[number]>) => void): Promise<ExecutionResult<TRow[number]>>;
    cursor(cb: (row: NonNullable<TRow[number]>) => void): Promise<ExecutionResult<TRow[number]>>;
    cursor(size: 1, cb: (row: NonNullable<TRow[number]>) => void): Promise<ExecutionResult<TRow[number]>>;
    cursor(size: number, cb: (rows: NonNullable<TRow[number]>[]) => void): Promise<ExecutionResult<TRow[number]>>;
  }

  interface PendingRequest extends Promise<[] & ResultMeta<null>> { }

  interface ListenRequest extends Promise<ListenMeta> { }
  interface ListenMeta extends ResultMeta<null> {
    unlisten(): Promise<void>
  }

  interface Helper<T, U extends any[] = T[]> {
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
    <T extends any[] = Row[]>(template: TemplateStringsArray, ...args: SerializableParameter[]): PendingQuery<AsRowList<T>>;

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

    END: {}; // FIXME unique symbol ?
    PostgresError: typeof PostgresError;

    array<T extends SerializableParameter[] = SerializableParameter[]>(value: T): ArrayParameter<T>;
    begin<T>(cb: (sql: TransactionSql<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>;
    begin<T>(options: string, cb: (sql: TransactionSql<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>;
    end(options?: { timeout?: number }): Promise<void>;
    file<T extends any[] = Row[]>(path: string, options?: { cache?: boolean }): PendingQuery<AsRowList<T>>;
    file<T extends any[] = Row[]>(path: string, args: SerializableParameter[], options?: { cache?: boolean }): PendingQuery<AsRowList<T>>;
    json(value: any): Parameter;
    listen(channel: string, cb: (value?: string) => void): ListenRequest;
    notify(channel: string, payload: string): PendingRequest;
    options: ParsedOptions<TTypes>;
    parameters: ConnectionParameters;
    types: {
      [name in keyof TTypes]: TTypes[name] extends (...args: any) => any
      ? (...args: Parameters<TTypes[name]>) => postgres.Parameter<ReturnType<TTypes[name]>>
      : (...args: any) => postgres.Parameter<any>;
    };
    unsafe<T extends any[] = Row[]>(query: string, parameters?: SerializableParameter[]): PendingQuery<AsRowList<T>>;
  }

  interface TransactionSql<TTypes extends JSToPostgresTypeMap> extends Sql<TTypes> {
    savepoint<T>(cb: (sql: TransactionSql<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>;
    savepoint<T>(name: string, cb: (sql: TransactionSql<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>;
  }

}

export = postgres;
