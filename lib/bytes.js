const size = 256
let buffer = Buffer.allocUnsafe(size)

const messages = {
  B: 'B'.charCodeAt(0),
  Q: 'Q'.charCodeAt(0),
  P: 'P'.charCodeAt(0),
  p: 'p'.charCodeAt(0)
}

const b = {
  i: 0,
  B() {
    buffer[0] = messages.B
    b.i = 5
    return b
  },
  Q() {
    buffer[0] = messages.Q
    b.i = 5
    return b
  },
  P() {
    buffer[0] = messages.P
    b.i = 5
    return b
  },
  p() {
    buffer[0] = messages.p
    b.i = 5
    return b
  },
  inc(x) {
    b.i += x
    return b
  },
  str(x) {
    const length = Buffer.byteLength(x)
    fit(length)
    b.i += buffer.utf8Write(x, b.i, length)
    return b
  },
  i16(x) {
    fit(2)
    buffer.writeUInt16BE(x, b.i)
    b.i += 2
    return b
  },
  i32(x, i) {
    if (i || i === 0) {
      buffer.writeUInt32BE(x, i)
      return b
    }
    fit(4)
    buffer.writeUInt32BE(x, b.i)
    b.i += 4
    return b
  },
  z(x) {
    fit(x)
    buffer.fill(0, b.i, b.i + x)
    b.i += x
    return b
  },
  end(at = 1) {
    buffer.writeUInt32BE(b.i - at, at)
    const out = buffer.slice(0, b.i)
    b.i = 0
    buffer = Buffer.allocUnsafe(size)
    return out
  }
}

module.exports = b

function fit(x) {
  if (buffer.length - b.i < x) {
    const prev = buffer
        , length = prev.length

    buffer = Buffer.allocUnsafe(length + (length >> 1) + x)
    prev.copy(buffer)
  }
}
