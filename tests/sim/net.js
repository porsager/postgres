import { EventEmitter } from 'events'

export function Random(seed) {
  let x = seed >>> 0
  const next = () => {
    x = (x + 0x6D2B79F5) >>> 0
    let t = Math.imul(x ^ (x >>> 15), 1 | x)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: p => next() < p,
    pick: xs => xs[Math.floor(next() * xs.length)]
  }
}

export function Clock(onerror = e => { throw e }) {
  const timers = new Map()
      , realImmediate = setImmediate
  let now = 0
    , seq = 0

  const add = (fn, ms, args) => {
    const id = { ref: () => id, unref: () => id, hasRef: () => true, [Symbol.toPrimitive]: () => id.seq }
    id.seq = ++seq
    id.at = now + Math.max(0, +ms || 0)
    id.fn = () => fn(...args)
    timers.set(id.seq, id)
    return id
  }
  const clear = id => id && timers.delete(id.seq)

  return {
    timers: {
      setTimeout: (fn, ms, ...args) => add(fn, ms, args),
      clearTimeout: clear,
      setImmediate: (fn, ...args) => add(fn, 0, args),
      clearImmediate: clear,
      now: () => now
    },
    get now() { return now },
    get pending() { return timers.size },
    pendingTimers: () => [...timers.values()],
    async run(until = Infinity) {
      let same = 0
        , at = now
      while (true) {
        await new Promise(realImmediate)
        same = now === at ? same + 1 : 0
        at = now
        if (same > 20000)
          throw new Error('Timer storm: 20,000 timers ran at ' + now + 'ms without the clock moving on')

        let next = null
        for (const x of timers.values())
          (!next || x.at < next.at || (x.at === next.at && x.seq < next.seq)) && (next = x)
        if (!next || next.at > until)
          break

        timers.delete(next.seq)
        now = next.at
        try {
          next.fn()
        } catch (e) {
          onerror(e)
        }
      }
      until !== Infinity && (now = Math.max(now, until))
    }
  }
}

export function Pipe({ clock, random, delay = 0, split = 0 }) {
  const { setTimeout } = clock.timers

  const client = end()
      , server = end()

  client.peer = server
  server.peer = client
  return { client, server }

  function end() {
    const x = new EventEmitter()
    let last = 0
      , paused = false
      , held = []

    Object.assign(x, {
      destroyed: false,
      writable: true,
      readable: true,
      write(data, encoding, cb) {
        typeof encoding === 'function' && (cb = encoding)
        if (x.destroyed || !x.writable)
          return false

        data = Buffer.from(data)
        for (const part of chop(data))
          send(part)
        cb && setTimeout(cb, 0)
        return true
      },
      end(data) {
        if (x.destroyed || !x.writable)
          return x

        data && data.length && x.write(data)
        x.writable = false
        later(() => x.peer.closed(false))
        return x
      },
      destroy(error) {
        if (x.destroyed)
          return x

        x.destroyed = true
        x.writable = x.readable = false
        setTimeout(() => {
          error && x.emit('error', error)
          x.emit('close', !!error)
        }, 0)
        later(() => x.peer.closed(true))
        return x
      },
      pause() { paused = true; return x },
      resume() {
        paused = false
        const xs = held
        held = []
        xs.forEach(receive)
        return x
      },
      get readyState() {
        return x.destroyed ? 'closed' : x.readable && x.writable ? 'open' : x.readable ? 'readOnly' : 'writeOnly'
      },
      setKeepAlive: () => x,
      setNoDelay: () => x,
      ref: () => x,
      unref: () => x,
      receive,
      closed(reset) {
        if (x.destroyed)
          return

        if (reset) {
          x.destroyed = true
          x.writable = x.readable = false
          const error = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
          x.emit('error', error)
          x.emit('close', true)
        } else {
          x.readable = false
          x.emit('end')
          x.writable && x.end()
          x.destroyed = true
          x.emit('close', false)
        }
      }
    })

    return x

    function receive(data) {
      if (x.destroyed)
        return
      paused ? held.push(data) : x.emit('data', data)
    }

    function chop(data) {
      if (!split || !random.chance(split) || data.length < 2)
        return [data]

      const at = random.int(1, data.length - 1)
      return [data.subarray(0, at), data.subarray(at)]
    }

    function later(fn) {
      last = Math.max(last, clock.now + (delay ? random.int(0, delay) : 0))
      setTimeout(fn, last - clock.now)
    }

    function send(data) {
      later(() => x.peer.receive(data))
    }
  }
}
