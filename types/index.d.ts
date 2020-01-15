/// <reference types="node" />

/**
 * Etablish a connection to a PostgreSQL server. 
 * @param options Connection options - default to the same as psql
 * @returns An utility function to make queries to the server
 */
declare function Postgres<T extends Postgres.CustomTypeList = {}>(options?: Postgres.Options<T>): Postgres.Tag<T>
/**
 * Etablish a connection to a PostgreSQL server. 
 * @param url Connection string used for authentication
 * @param options Connection options - default to the same as psql
 * @returns An utility function to make queries to the server
 */
declare function Postgres<T extends Postgres.CustomTypeList = {}>(url: string, options?: Postgres.Options<T>): Postgres.Tag<T>

/**
 * Connection options of Postgres.
 */
interface BaseOptions<T extends Postgres.CustomTypeList> {
  /** Postgres ip address or domain name */
  host?: string;
  /** Postgres server port */
  port?: number;
  /** Name of database to connect to */
  database?: string;
  /** Username of database user */
  username?: string;
  /** True; or options for tls.connect */
  ssl?: boolean | import('tls').TlsOptions;
  /** Max number of connections */
  max?: number;
  /** Idle connection timeout in seconds */
  timeout?: number;
  /** Array of custom types; see more below */
  types?: T;
  /** Defaults to console.log */
  onnotice?: (notice: string) => void;
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
  connection?: Postgres.ConnectionVariables;
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

  interface ConnectionVariables {
    /** Default application_name */
    application_name?: string;
    /** Other connection parameters */
    [name: string]: any;
  }

  interface Options<T extends CustomTypeList> extends BaseOptions<T> {
    /** unix socket path (usually '/tmp') */
    path?: string;
    /** Password of database user */
    pass?: string | (() => string | Promise<string>);
    /** Password of database user */
    password?: Options<T>['pass']; // FIXME Is it a doc error ?
  }

  interface ParsedOptions<T extends CustomTypeList> extends BaseOptions<T> {
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
    types: T;
    /** @inheritdoc */
    transform: NonNullable<Options<T>['transform']>
    /** @inheritdoc */
    ssl: boolean;
    /** @inheritdoc */
    serializers: { [oid: number]: CustomType['serialize'] };
    /** @inheritdoc */
    parsers: { [oid: number]: CustomType['parse'] };
  }

  interface CustomType {
    to: number,
    from: number[],
    serialize(obj: unknown): unknown,
    parse(raw: any): unknown
  }

  interface CustomTypeList {
    [name: string]: CustomType
  }

  interface QueryValue<T = Serializable> {
    /**
     * PostgreSQL OID of the type
     */
    type: number;
    /**
     * Value to serialize
     */
    value: T;
  }

  interface QueryArrayValue<T extends any[] = any[]> extends QueryValue<T> {
    array: true;
  }

  type Serializable = any;

  interface Row {
    [column: string]: Serializable;
  }

  type QueryResult<T> = T;

  type QueryResultArray<T> =
    (T extends readonly any[] ? T : readonly T[]) &
    {
      count: T extends readonly any[] ? T['length'] : number, // For tuples
      command: string
    };

  interface QueryResultPromise<T = unknown> extends Promise<QueryResultArray<T>> {
    stream(cb: (row: QueryResult<T extends readonly (infer R)[] ? R : T>) => void): QueryResultPromise<T>;
    // cursor(size: number): AsyncIterable<QueryResult>;
    // cursor(size: number, cb: (row: QueryResult) => void): QueryResultPromise;
  }

  interface QueryParameter<T, U extends any[] = T[]> {
    first: T;
    rest: U;
  }

  interface Tag<TTypes extends CustomTypeList> {

    /**
     * Execute the SQL query passed as a template string. Can only be used as template string tag.
     * @param template The template generated from the template string
     * @param args Interpoled values of the template string
     * @returns A promise resolving to the result of your query
     */
    <T = any[]>(template: TemplateStringsArray, ...args: Serializable[]): QueryResultPromise<T>;
    (...toEscape: string[]): QueryParameter<string>;
    <T>(parametersList: T[]): QueryParameter<T, never>;
    <T extends {}, U extends keyof T extends string ? (keyof T)[] : never>(obj: T, ...keys: U): QueryParameter<T, U>;

    array<T extends any[] = any[]>(value: T): QueryArrayValue<T>;
    begin<T>(cb: (sql: TransactionTag<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>;
    begin<T>(options: string, cb: (sql: TransactionTag<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>;
    end(): Promise<void>;
    end(options?: { timeout?: number }): Promise<void>;
    file<T = any[]>(path: string, options?: { cache?: boolean }): QueryResultPromise<T>;
    file<T = any[]>(path: string, args?: Serializable[], options?: { cache?: boolean }): QueryResultPromise<T>;
    json(value: any): QueryValue;
    listen(channel: string, cb: (value?: string) => void): QueryResultPromise<void>;
    notify(channel: string, payload: string): QueryResultPromise<void>;
    options: ParsedOptions<TTypes>;
    parameters: ConnectionVariables;
    types: {
      [name in keyof TTypes]: (obj: Parameters<TTypes[name]['serialize']>[0]) => QueryValue<typeof obj>;
    };
    unsafe<T = any[]>(query: string, parameters?: Serializable[]): QueryResultPromise<T>;
  }

  interface TransactionTag<TTypes extends CustomTypeList> extends Tag<TTypes> {
    savepoint<T>(cb: (sql: TransactionTag<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>;
    savepoint<T>(name: string, cb: (sql: TransactionTag<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>;
  }

}

export = Postgres;