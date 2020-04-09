class PostgresError extends Error {
  constructor(x) {
    super(x.message)
    this.name = this.constructor.name
    Object.assign(this, x)
  }
}

module.exports.PostgresError = PostgresError

module.exports.errors = {
  connection,
  postgres,
  generic,
  notSupported
}

function connection(x, options) {
  const error = Object.assign(
    new Error(('write ' + x + ' ' + (options.path || (options.host + ':' + options.port)))),
    {
      code: x,
      errno: x,
      address: options.path || options.host
    }, options.path ? {} : { port: options.port }
  )
  Error.captureStackTrace(error, connection)
  return error
}

function postgres(x) {
  const error = new PostgresError(x)
  Error.captureStackTrace(error, postgres)
  return error
}

function generic(x) {
  const error = Object.assign(new Error(x.message), x)
  Error.captureStackTrace(error, generic)
  return error
}

function notSupported(x) {
  const error = Object.assign(
    new Error(x + ' (B) is not supported'),
    {
      code: 'MESSAGE_NOT_SUPPORTED',
      name: x
    }
  )
  Error.captureStackTrace(error, notSupported)
  return error
}
