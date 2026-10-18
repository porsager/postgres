export default class Result extends Array {
  #count = null
  #state = null
  #command = null
  #columns = null
  #statement = null

  get count() { return this.#count }
  set count(x) { this.#count = x }
  get state() { return this.#state }
  set state(x) { this.#state = x }
  get command() { return this.#command }
  set command(x) { this.#command = x }
  get columns() { return this.#columns }
  set columns(x) { this.#columns = x }
  get statement() {
    const x = this.#statement
    return x && x.kind ? (this.#statement = statement(x)) : x
  }

  set statement(x) { this.#statement = x }

  static get [Symbol.species]() {
    return Array
  }
}

export function statement(item) {
  const x = item.statement
  return {
    name: x ? x.name : '',
    string: x ? x.text : item.text || '',
    types: item.params || (item.entry && item.entry.oids) || (x && x.oids) || [],
    columns: item.columns || []
  }
}
