import dc from 'diagnostics_channel'

export const channels = {
  query: tracing('postgres:query'),
  connect: tracing('postgres:connect'),
  transaction: tracing('postgres:transaction'),
  pool: plain('postgres:pool'),
  notice: plain('postgres:notice')
}

const done = Symbol('done')

export const now = () => performance.now()

export const userName = options => typeof options.user === 'function' ? null : options.user

export function active(t) {
  return !!t && (t.hasSubscribers !== undefined
    ? t.hasSubscribers
    : t.start.hasSubscribers || t.end.hasSubscribers || t.asyncStart.hasSubscribers
      || t.asyncEnd.hasSubscribers || t.error.hasSubscribers)
}

export function listened(channel) {
  return !!channel && channel.hasSubscribers
}

export function start(t, context, fn) {
  return typeof t.start.runStores === 'function'
    ? t.start.runStores(context, run)
    : (t.start.publish(context), run())

  function run() {
    try {
      return fn()
    } finally {
      t.end.publish(context)
    }
  }
}

export function finish(t, context, error, result) {
  if (context[done])
    return

  context[done] = true

  if (error) {
    context.error = error
    t.error.publish(context)
  } else {
    context.result = result
  }

  t.asyncStart.publish(context)
  t.asyncEnd.publish(context)
}

function tracing(name) {
  try {
    return typeof dc.tracingChannel === 'function' ? dc.tracingChannel(name) : null
  } catch (error) {
    return null
  }
}

function plain(name) {
  try {
    return dc.channel(name)
  } catch (error) {
    return null
  }
}
