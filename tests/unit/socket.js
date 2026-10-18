import { EventEmitter } from 'events'
import { t } from '../test.js'
import { Socket } from '../../src/socket.js'

function fake() {
  const x = new EventEmitter()
  x.written = []
  x.write = data => (x.written.push(data), true)
  x.end = data => (data && x.written.push(data), x.ended = true)
  x.destroy = () => x.emit('close', true)
  x.pause = () => x.paused = true
  x.resume = () => x.paused = false
  return x
}

t('Socket takes the user socket', async() => {
  const raw = fake()
      , socket = await Socket({ socket: () => raw })
  return [true, socket.raw === raw]
})

t('Socket passes data, drain and writes through', async() => {
  const raw = fake()
      , socket = await Socket({ socket: async() => raw })
      , got = []
  socket.ondata = x => got.push(x.toString())
  socket.ondrain = () => got.push('drain')
  raw.emit('data', Buffer.from('a'))
  raw.emit('drain')
  socket.write(Buffer.from('b'))
  return ['a,drain|b', got.join() + '|' + raw.written.join()]
})

t('Socket closes once with the error that came before', async() => {
  const raw = fake()
      , socket = await Socket({ socket: () => raw })
      , closes = []
  socket.onclose = x => closes.push(x && x.code)
  raw.emit('error', Object.assign(new Error('reset'), { code: 'ECONNRESET' }))
  raw.emit('close', true)
  raw.emit('close', true)
  return ['ECONNRESET', closes.join()]
})

t('Socket does not write after close', async() => {
  const raw = fake()
      , socket = await Socket({ socket: () => raw })
  raw.emit('close', false)
  return ['false,0,true', [socket.write(Buffer.from('x')), raw.written.length, socket.closed].join()]
})

t('Socket pause and resume reach the user socket', async() => {
  const raw = fake()
      , socket = await Socket({ socket: () => raw })
  socket.pause()
  const paused = raw.paused
  socket.resume()
  return ['true,false', paused + ',' + raw.paused]
})

t('Socket rejects when the user socket fails', async() => [
  'nope',
  await Socket({ socket: () => { throw new Error('nope') } }).catch(e => e.message)
])

t('Socket reads plain TCP through a shared buffer unless onread is false', async() => {
  const net = await import('net')
      , server = net.createServer(x => x.end())
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
      , shared = await Socket({ ssl: false }, '127.0.0.1', port)
      , stream = await Socket({ ssl: false, onread: false }, '127.0.0.1', port)
  shared.destroy()
  stream.destroy()
  server.close()
  return ['true,false', [shared.shared, stream.shared].join()]
})
