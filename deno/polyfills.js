import { Buffer } from 'https://deno.land/std@0.107.0/node/buffer.ts'

export const net = {
  connect: (...xs) => {
    let paused
      , resume
      , count = 1

    const socket = {
      error,
      success,
      pause: () => {
        paused = new Promise(r => resume = r)
      },
      resume: () => {
        resume()
        paused = null
      },
      isPaused: () => !!paused,
      port: xs[0],
      hostname: xs[1],
      events: { data: [], error: [], connect: [], secureConnect: [], close: [] },
      raw: null,
      on: (x, fn) => socket.events[x].push(fn),
      once: (x, fn) => {
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
        socket.raw.write(x)
          .then(() => cb && cb(null))
          .catch(err => cb && cb(err))
      },
      destroy: () => close(true),
      end: close
    }

    xs.length === 1
      ? Deno.connect({ transport: 'unix', path: xs[0] }).then(success, error)
      : Deno.connect({ transport: 'tcp', port: xs[0], hostname: xs[1] }).then(success, error)

    return socket

    async function success(raw) {
      const secure = socket.secure
      socket.raw = raw
      socket.secure
        ? call(socket.events.secureConnect)
        : call(socket.events.connect)

      const b = new Uint8Array(1024)
      let result

      try {
        while ((result = !socket.closed && await raw.read(b))) {
          call(socket.events.data, Buffer.from(b.subarray(0, result)))
          paused && await paused
        }
      } catch (e) {
        if (e instanceof Deno.errors.BadResource === false)
          error(e)
      }
      ;(!socket.secure || secure) && close()
    }

    function close() {
      try {
        socket.raw && socket.raw.close()
      } catch (e) {
        if (e instanceof Deno.errors.BadResource === false)
          call(socket.events.error, e)
      }
      closed()
    }

    function closed() {
      if (socket.closed)
        return

      call(socket.events.close)
      socket.closed = true
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
  connect: ({ socket, ...options }) => {
    socket.secure = true
    Deno.startTls(socket.raw, { hostname: socket.hostname, port: socket.port, ...options })
      .then(socket.success, socket.error)
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

