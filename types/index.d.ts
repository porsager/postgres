/**
 * Establish a connection to a PostgreSQL server.
 * @param options Connection options - default to the same as psql
 * @returns An utility function to make queries to the server
 */
declare function Postgres<T extends Postgres.PostgresTypeList = {}>(options?: Postgres.Options<T>): Postgres.Sql<T>
/**
 * Establish a connection to a PostgreSQL server.
 * @param url Connection string used for authentication
 * @param options Connection options - default to the same as psql
 * @returns An utility function to make queries to the server
 */
declare function Postgres<T extends Postgres.PostgresTypeList = {}>(url: string, options?: Postgres.Options<T>): Postgres.Sql<T>

/**
 * Connection options of Postgres.
 */
interface BaseOptions<T extends Postgres.PostgresTypeList> {
  /** Postgres ip address or domain name */
  host?: string;
  /** Postgres server port */
  port?: number;
  /** Name of database to connect to */
  database?: string;
  /** Username of database user */
  username?: string;
  /** True; or options for tls.connect */
  ssl?: boolean | object;
  /** Max number of connections */
  max?: number;
  /** Idle connection timeout in seconds */
  idle_timeout?: number;
  /** Connect timeout in seconds */
  connect_timeout?: number;
  /** Array of custom types; see more below */
  types?: T;
  /** Defaults to console.log */
  onnotice?: (notice: Postgres.Notice) => void;
  /** (key; value) when server param change */
  onparameter?: (key: string, value: any) => void;
  /** Is called with (connection; query; parameters) */
  debug?: (connection: number, query: string, parameters: any[]) => void;
  /** Transform hooks */
  transform?: {
    /** Transforms incoming column names */
    column?: (column: string) => any;
    /** Transforms incoming row values */
    value?: (value: any) => any;
    /** Transforms entire rows */
    row?: (row: Postgres.Row) => any;
  };
  /** Connection parameters */
  connection?: Postgres.ConnectionParameters;
}

type UnwrapPromiseArray<T> = T extends any[] ? {
  [k in keyof T]: T[k] extends Promise<infer R> ? R : T[k]
} : T;

declare namespace Postgres {

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

  const BitInt: PostgresType;

  interface ConnectionParameters {
    /** Default application_name */
    application_name?: string;
    /** Other connection parameters */
    [name: string]: any;
  }

  interface Options<T extends PostgresTypeList> extends BaseOptions<T> {
    /** unix socket path (usually '/tmp') */
    path?: string;
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

  interface ParsedOptions<T extends PostgresTypeList> extends BaseOptions<T> {
    /** @inheritdoc */
    host: string;
    /** @inheritdoc */
    port: number;
    /** @inheritdoc */
    path: string | false;
    /** @inheritdoc */
    database: string;
    /** @inheritdoc */
    user: string;
    /** @inheritdoc */
    pass: null;
    /** @inheritdoc */
    max: number;
    /** @inheritdoc */
    connect_timeout?: number;
    /** @inheritdoc */
    types: T;
    /** @inheritdoc */
    transform: NonNullable<Options<T>['transform']>
    /** @inheritdoc */
    ssl: boolean;
    /** @inheritdoc */
    serializers: { [oid: number]: PostgresType['serialize'] };
    /** @inheritdoc */
    parsers: { [oid: number]: PostgresType['parse'] };
  }

  interface Notice {
    [field: string]: string;
  }

  interface PostgresType {
    to: number,
    from: number[],
    serialize(obj: unknown): unknown,
    parse(raw: any): unknown
  }

  interface PostgresTypeList {
    [name: string]: PostgresType
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

  interface ArrayParameter<T extends any[] = any[]> extends Parameter<T> {
    array: true;
  }

  type Serializable = null
    | boolean
    | number
    | string
    | Date
    | object;

  interface Row {
    [column: string]: any;
  }

  interface ResultInfo<T extends number> {
    count: T, // For tuples
    command: string
  }

  type RowList<T extends readonly any[]> = T & ResultInfo<T['length']>;

  interface PendingQuery<TRow extends readonly Row[]> extends Promise<RowList<TRow>> {
    stream(cb: (row: TRow[number]) => void): Promise<RowList<[]>>;
    cursor(cb: (row: TRow[number]) => void): Promise<RowList<[]>>;
    cursor(size: 1, cb: (row: TRow[number]) => void): Promise<RowList<[]>>;
    cursor(size: number, cb: (row: TRow) => void): Promise<RowList<[]>>;
  }

  interface Helper<T, U extends any[] = T[]> {
    first: T;
    rest: U;
  }

  interface Sql<TTypes extends PostgresTypeList> {

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
      [name in keyof TTypes]: (obj: Parameters<TTypes[name]['serialize']>[0]) => Parameter<typeof obj>;
    };
    unsafe<T extends Row | Row[] = any[]>(query: string, parameters?: Serializable[]): PendingQuery<T extends Row[] ? T : T[]>;
  }

  interface TransactionSql<TTypes extends PostgresTypeList> extends Sql<TTypes> {
    savepoint<T>(cb: (sql: TransactionSql<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>;
    savepoint<T>(name: string, cb: (sql: TransactionSql<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>;
  }

}

export = Postgres;