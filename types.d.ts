/// <reference types="node" />

declare function Postgres(options?: Postgres.Options): Postgres.Tag
declare function Postgres(url: string, options?: Postgres.Options): Postgres.Tag

declare namespace Postgres {

  function toPascal(): never;
  function toCamel(): never;
  function toKebab(): never;

  interface Options {
    /** Postgres ip address or domain name */
    host?: string;
    /** Postgres server port */
    port?: number;
    /** unix socket path (usually '/tmp') */
    path?: string;
    /** Name of database to connect to */
    database?: string;
    /** Username of database user */
    username?: string;
    /** Password of database user */
    password?: string | (() => string | PromiseLike<string>);
    /** Password of database user */
    pass?: string | (() => string | PromiseLike<string>);
    /** True; or options for tls.connect */
    ssl?: false | import('tls').TlsOptions;
    /** Max number of connections */
    max?: number;
    /** Idle connection timeout in seconds */
    timeout?: number;
    /** Array of custom types; see more below */
    types?: { [name: string]: { [index: string]: any, serialize(obj: any): string, parse(str: string): any } };
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
      row?: (row: Row) => any;
    };
    /** Connection parameters */
    connection?: ConnectionParameters;
  }

  interface ConnectionParameters {
    /** Default application_name */
    application_name?: string;
    /** Other connection parameters */
    [name: string]: any;
  }

  interface DynamicParameter { /* Internal Type */ }

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
    cursor(size: number, cb: (row: QueryResult) => void): QueryResultPromise;
  }

  type UnwrapPromiseArray<T> = {
    [k in keyof T]: T[k] extends PromiseLike<infer R> ? R : T[k]
  }

  interface Tag {
    (template: TemplateStringsArray, ...args: Serializable[]): QueryResultPromise;
    (...text: string[]): DynamicParameter;
    (object: object): DynamicParameter;
    <T extends { [key: string]: any }>(object: T, ...args: (keyof T)[]): DynamicParameter;

    array(value: Serializable[]): DynamicParameter;
    begin<T>(cb: (sql: TransactionTag) => T | PromiseLike<T>): Promise<UnwrapPromiseArray<T>>;
    begin<T>(options: string, cb: (sql: TransactionTag) => T | PromiseLike<T>): Promise<UnwrapPromiseArray<T>>;
    end(): Promise<void>;
    end(options?: { timeout?: number }): Promise<void>;
    file(path: string, options?: { cache?: boolean }): QueryResultPromise;
    file(path: string, args?: Serializable[], options?: { cache?: boolean }): QueryResultPromise;
    json(value: any): DynamicParameter;
    listen(channel: string, cb: (value?: string) => void): Promise<void>;
    notify(channel: string, payload: string): Promise<void>;
    options: any;
    parameters: ConnectionParameters;
    types: any;
    unsafe(query: string, parameters?: Serializable[]): QueryResultPromise;
  }

  interface TransactionTag extends Tag {
    savepoint<T>(cb: (sql: TransactionTag) => T | PromiseLike<T>): Promise<UnwrapPromiseArray<T>>;
    savepoint<T>(name: string, cb: (sql: TransactionTag) => T | PromiseLike<T>): Promise<UnwrapPromiseArray<T>>;
  }

}

export = Postgres;