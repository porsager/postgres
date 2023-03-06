/* global Deno */

import { Buffer } from 'https://deno.land/std@0.132.0/node/buffer.ts'
import { isIP } from 'https://deno.land/std@0.132.0/node/net.ts'

const events = () => ({ data: [], error: [], drain: [], connect: [], secureConnect: [], close: [] })

export const net = {
  isIP,
  createServer() {
    const server =  {
      address() {
        return { port: 9876 }
      },
      async listen() {
        server.raw = Deno.listen({ port: 9876, transport: 'tcp' })
        for await (const conn of server.raw)
          setTimeout(() => conn.close(), 500)
      },
      close() {
        server.raw.close()
      }
    }
    return server
  },
  Socket() {
    let paused
      , resume
      , keepAlive

    const socket = {
      error,
      success,
      readyState: 'open',
      setKeepAlive: x => {
        keepAlive = x
        socket.raw && socket.raw.setKeepAlive && socket.raw.setKeepAlive(x)
      },
      connect: (port, hostname) => {
        socket.raw = null
        socket.readyState = 'connecting'
        typeof port === 'string'
          ? Deno.connect({ transport: 'unix', path: socket.path = port }).then(success, error)
          : Deno.connect({ transport: 'tcp', port: socket.port = port, hostname: socket.hostname = hostname || 'localhost' }).then(success, error) // eslint-disable-line
        return socket
      },
      pause: () => {
        paused = new Promise(r => resume = r)
      },
      resume: () => {
        resume && resume()
        paused = null
      },
      isPaused: () => !!paused,
      removeAllListeners: () => socket.events = events(),
      events: events(),
      raw: null,
      on: (x, fn) => socket.events[x].push(fn),
      once: (x, fn) => {
        if (x === 'data')
          socket.break = true
        const e = socket.events[x]
        e.push(once)
        once.once = fn
        function once(...args) {
          fn(...args)
          e.indexOf(once) > -1 && e.splice(e.indexOf(once), 1)
        }
      },
      removeListener: (x, fn) => {
        socket.events[x] = socket.events[x].filter(x => x !== fn && x.once !== fn)
      },
      write: (x, cb) => {
        socket.raw.write(x).then(l => {
          l < x.length
            ? socket.write(x.slice(l), cb)
            : (cb && cb(null))
        }).catch(err => {
          cb && cb()
          call(socket.events.error, err)
        })
        return false
      },
      destroy: () => close(),
      end: (x) => {
        x && socket.write(x)
        close()
      }
    }

    return socket

    async function success(raw) {
      if (socket.readyState !== 'connecting')
        return raw.close()

      const encrypted = socket.encrypted
      socket.raw = raw
      keepAlive != null && raw.setKeepAlive && raw.setKeepAlive(keepAlive)
      socket.readyState = 'open'
      socket.encrypted
        ? call(socket.events.secureConnect)
        : call(socket.events.connect)

      const b = new Uint8Array(1024)
      let result

      try {
        while ((result = socket.readyState === 'open' && await raw.read(b))) {
          call(socket.events.data, Buffer.from(b.subarray(0, result)))
          if (!encrypted && socket.break && (socket.break = false, b[0] === 83))
            return socket.break = false
          paused && await paused
        }
      } catch (e) {
        if (e instanceof Deno.errors.BadResource === false)
          error(e)
      }

      if (!socket.encrypted || encrypted)
        closed()
    }

    function close() {
      try {
        socket.raw && socket.raw.close()
      } catch (e) {
        if (e instanceof Deno.errors.BadResource === false)
          call(socket.events.error, e)
      }
    }

    function closed() {
      if (socket.readyState === 'closed')
        return

      socket.break = socket.encrypted = false
      socket.readyState = 'closed'
      call(socket.events.close)
    }

    function error(err) {
      call(socket.events.error, err)
      socket.raw
        ? close()
        : closed()
    }

    function call(xs, x) {
      xs.slice().forEach(fn => fn(x))
    }
  }
}

export const tls = {
  connect({ socket, ...options }) {
    socket.encrypted = true
    socket.readyState = 'connecting'
    Deno.startTls(socket.raw, { hostname: socket.hostname, ...options })
      .then(socket.success, socket.error)
    socket.raw = null
    return socket
  }
}

let ids = 1
const tasks = new Set()
export const setImmediate = fn => {
  const id = ids++
  tasks.add(id)
  queueMicrotask(() => {
    if (tasks.has(id)) {
      fn()
      tasks.delete(id)
    }
  })
  return id
}

export const clearImmediate = id => tasks.delete(id)

