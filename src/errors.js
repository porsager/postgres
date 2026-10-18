export class PostgresError extends Error {
  constructor(x) {
    super(typeof x === 'string' ? x : x && x.message)
    this.name = this.constructor.name
    x && typeof x === 'object' && Object.assign(this, x)
  }

  toJSON() {
    return { ...this, message: this.message }
  }
}

export const Errors = {
  connection,
  postgres,
  generic,
  notSupported
}

function connection(code, options, host, port) {
  const address = options.path || host
      , error = Object.assign(
        new Error('write ' + code + ' ' + (options.path || host + ':' + port)),
        { code, errno: code, address },
        options.path ? {} : { port }
      )

  Error.captureStackTrace(error, connection)
  return error
}

function postgres(x) {
  const error = new PostgresError(x)
  Error.captureStackTrace(error, postgres)
  return error
}

function generic(code, message) {
  const error = Object.assign(new Error(code + ': ' + message), { code })
  Error.captureStackTrace(error, generic)
  return error
}

function notSupported(x) {
  const error = Object.assign(new Error(x + ' (B) is not supported'), { code: 'MESSAGE_NOT_SUPPORTED', name: x })
  Error.captureStackTrace(error, notSupported)
  return error
}

const places = locations()

export const ours = line => places.some(here => line.includes(here) && !line.slice(line.indexOf(here) + here.length).split(':')[0].includes('/'))

function locations() {
  try {
    const url = new URL('.', import.meta.url)
    return url.protocol === 'file:' ? [url.href, decodeURIComponent(url.pathname)] : [url.href]
  } catch (error) {
    return []
  }
}

export function withOrigin(error, origin) {
  origin && Object.defineProperty(error, 'stack', {
    value: [error.stack.split('\n')[0], ...origin.split('\n').slice(1).filter(x => !ours(x))].join('\n'),
    writable: true,
    configurable: true,
    enumerable: false
  })
  return error
}

export function queryError(error, q, debug) {
  if (!error || typeof error !== 'object')
    error = new Error(error)

  if (!q || 'query' in error)
    return error

  const built = q.built
  Object.defineProperties(error, {
    query: { value: built ? built.text : q.strings[0], enumerable: !!debug, configurable: true, writable: true },
    parameters: { value: built ? built.values : [], enumerable: !!debug, configurable: true, writable: true },
    args: { value: q.args, enumerable: !!debug, configurable: true, writable: true },
    types: { value: built ? built.oids : [], enumerable: !!debug, configurable: true, writable: true }
  })
  return withOrigin(error, q.origin)
}
