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
    serializers: { [id: number]: CustomType['serialize'] };
    /** @inheritdoc */
    parsers: { [id: number]: CustomType['parse'] };
  }

  interface CustomType {
    to: number,
    from: number[],
    serialize(obj: unknown): unknown,
    parse(str: any): unknown
  }

  interface CustomTypeList {
    [name: string]: CustomType
  }

  interface QueryValue<T = any> {
    type: number;
    value: T;
  }

  interface QueryArrayValue<T extends any[] = any[]> extends QueryValue<T> {
    array: true;
  }

  type Serializable = any;

  interface Row {
    [column: string]: Serializable;
  }

  interface QueryResult extends Row, Iterable<Row> {  // FIXME Multiple statements
    [index: number]: Row;
  }

  interface QueryResultArray extends Array<QueryResult> {
    count: number;
    command: string;
  }

  interface QueryResultPromise extends Promise<QueryResultArray> {
    stream(cb: (row: QueryResult) => void): QueryResultPromise;
    // cursor(size: number): AsyncIterable<QueryResult>;
    // cursor(size: number, cb: (row: QueryResult) => void): QueryResultPromise;
  }

  interface QueryParameter<T, U extends any[] = T[]> extends Promise<never> { // FIXME Remove promise inheritance as an error is always throws
    first: T;
    rest: U;
  }

  interface Tag<TTypes extends CustomTypeList> {

    /**
     * Execute an SQL query passed as a template string. Can only be used as template string tag.
     * @param template The template generated from the template string
     * @param args Interpoled values of the template string
     * @returns A promise of the query passed to this function
     */
    (template: TemplateStringsArray, ...args: Serializable[]): QueryResultPromise;
    <T, U extends any[]>(first: T, ...args: U): QueryParameter<T>; // TODO Rewrite this

    array<T extends any[] = any[]>(value: T): QueryArrayValue<T>;
    begin<T>(cb: (sql: TransactionTag<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>;
    begin<T>(options: string, cb: (sql: TransactionTag<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>;
    end(): Promise<void>;
    end(options?: { timeout?: number }): Promise<void>;
    file(path: string, options?: { cache?: boolean }): QueryResultPromise;
    file(path: string, args?: Serializable[], options?: { cache?: boolean }): QueryResultPromise;
    json(value: any): QueryValue;
    listen(channel: string, cb: (value?: string) => void): Promise<void>;
    notify(channel: string, payload: string): Promise<void>;
    options: ParsedOptions<TTypes>;
    parameters: ConnectionVariables;
    types: { [name in keyof TTypes]: (...args: Parameters<TTypes[name]['serialize']>) => QueryValue<ReturnType<TTypes[name]['parse']>> };
    unsafe(query: string, parameters?: Serializable[]): QueryResultPromise;
  }

  interface TransactionTag<TTypes extends CustomTypeList> extends Tag<TTypes> {
    savepoint<T>(cb: (sql: TransactionTag<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>;
    savepoint<T>(name: string, cb: (sql: TransactionTag<TTypes>) => T | Promise<T>): Promise<UnwrapPromiseArray<T>>;
  }

}

export = Postgres;