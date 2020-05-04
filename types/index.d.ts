/**
 * Establish a connection to a PostgreSQL server.
 * @param options Connection options - default to the same as psql
 * @returns An utility function to make queries to the server
 */
declare function postgres<T extends PostgresTypeMap = {}>(options?: postgres.Options<T>): postgres.Sql<T>
/**
 * Establish a connection to a PostgreSQL server.
 * @param url Connection string used for authentication
 * @param options Connection options - default to the same as psql
 * @returns An utility function to make queries to the server
 */
declare function postgres<T extends PostgresTypeMap = {}>(url: string, options?: postgres.Options<T>): postgres.Sql<T>

/**
 * Connection options of Postgres.
 */
interface BaseOptions<T extends PostgresTypeMap> {
  /** Postgres ip address or domain name */
  host: string;
  /** Postgres server port */
  port: number;
  /** Name of database to connect to */
  database: string;
  /** Username of database user */
  username: string;
  /** True; or options for tls.connect */
  ssl: boolean | object;
  /** Max number of connections */
  max: number;
  /** Idle connection timeout in seconds */
  idle_timeout: number | undefined;
  /** Connect timeout in seconds */
  connect_timeout: number;
  /** Array of custom types; see more below */
  types: PostgresTypeList<T>;
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

type PostgresTypeList<T extends PostgresTypeMap> = {
  [name in keyof T]: postgres.PostgresType<T[name]>;
};

interface PostgresTypeMap {
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

declare namespace postgres {

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

  const BigInt: PostgresType<BigInt>;

  interface ConnectionParameters {
    /** Default application_name */
    application_name: string;
    /** Other connection parameters */
    [name: string]: any;
  }

  interface Options<T extends PostgresTypeMap> extends Partial<BaseOptions<T>> {
    /** unix socket path (usually '/tmp') */
    path?: string | (() => string);
    /** Password of database user (an alias for `password`) */
    pass?: Options<T>['password'];
    /** Password of database user */
    password?: string | (() => string | Promise<string>);
    /** Name of database to connect to (an alias for `database`) */
    db?: Options<T>['database'];
    /** Username of database user (an alias for `username`) */
    user?: Options<T>['username'];
    /** Postgres ip address or domain name (an alias for `host`) */
    hostname?: Options<T>['host'];
  }

  interface ParsedOptions<T extends PostgresTypeMap> extends BaseOptions<T> {
    /** @inheritdoc */
    pass: null;
    serializers: { [oid: number]: PostgresType['serialize'] };
    parsers: { [oid: number]: PostgresType['parse'] };
  }

  interface Notice {
    [field: string]: string;
  }

  interface PostgresType<T = unknown> {
    to: number;
    from: number[];
    serialize(obj: T): Serializable;
    parse(raw: any): T;
  }

  interface Parameter<T = Serializable> {
    /**
     * PostgreSQL OID of the type
     */
    type: number;
    /**
     * Value to serialize
     */
    value: T;
  }

  interface ArrayParameter<T extends Serializable[] = Serializable[]> extends Parameter<T> {
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
    | object;

  interface Row {
    [column: string]: any;
  }

  interface Column<T extends string> {
    name: T;
    type: number;
    parser(raw: string): string;
  }

  type ColumnList<T> = (T extends string ? Column<T> : never)[];

  interface ResultMeta<T extends number, U> {
    count: T; // For tuples
    command: string;
    columns: ColumnList<U>;
  }

  type ExecutionResult<T> = [] & ResultMeta<number, T>;
  type RowList<T extends readonly Row[]> = T & ResultMeta<T['length'], keyof T[number]>;

  interface PendingQuery<TRow extends readonly Row[]> extends Promise<RowList<TRow>> {
    stream(cb: (row: TRow[number], result: ExecutionResult<TRow[number]>) => void): Promise<ExecutionResult<keyof TRow[number]>>;
    cursor(cb: (row: TRow[number]) => void): Promise<ExecutionResult<keyof TRow[number]>>;
    cursor(size: 1, cb: (row: TRow[number]) => void): Promise<ExecutionResult<keyof TRow[number]>>;
    cursor(size: number, cb: (rows: TRow) => void): Promise<ExecutionResult<keyof TRow[number]>>;
  }

  interface Helper<T, U extends any[] = T[]> {
    first: T;
    rest: U;
  }

  interface Sql<TTypes extends PostgresTypeMap> {

    /**
     * Execute the SQL query passed as a template string. Can only be used as template string tag.
     * @param template The template generated from the template string
     * @param args Interpoled values of the template string
     * @returns A promise resolving to the result of your query
     */
    <T extends Row | Row[] = Row>(template: TemplateStringsArray, ...args: Serializable[]): PendingQuery<T extends Row[] ? T : T[]>;

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
    <T extends object, U extends (keyof (T extends any[] ? T[number] : T))[]>(objOrArray: T, ...keys: U): Helper<T, U>;

    END: {}; // FIXME unique symbol ?
    PostgresError: typeof PostgresError;

    array<T extends Serializable[] = Serializable[]>(value: T): ArrayParameter<T>;
    begin<T>(cb: (sql: TransactionSql<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>;
    begin<T>(options: string, cb: (sql: TransactionSql<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>;
    end(): Promise<void>;
    end(options?: { timeout?: number }): Promise<void>;
    file<T extends Row | Row[] = Row>(path: string, options?: { cache?: boolean }): PendingQuery<T extends Row[] ? T : T[]>;
    file<T extends Row | Row[] = Row>(path: string, args?: Serializable[], options?: { cache?: boolean }): PendingQuery<T extends Row[] ? T : T[]>;
    json(value: any): Parameter;
    listen(channel: string, cb: (value?: string) => void): PendingQuery<never[]>;
    notify(channel: string, payload: string): PendingQuery<never[]>;
    options: ParsedOptions<TTypes>;
    parameters: ConnectionParameters;
    types: {
      [name in keyof TTypes]: <T extends TTypes[name]>(obj: T) => Parameter<T>;
    };
    unsafe<T extends Row | Row[] = any[]>(query: string, parameters?: Serializable[]): PendingQuery<T extends Row[] ? T : T[]>;
  }

  interface TransactionSql<TTypes extends PostgresTypeMap> extends Sql<TTypes> {
    savepoint<T>(cb: (sql: TransactionSql<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>;
    savepoint<T>(name: string, cb: (sql: TransactionSql<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>;
  }

}

export = postgres;