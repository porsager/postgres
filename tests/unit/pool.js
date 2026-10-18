import v8 from 'v8'
import vm from 'vm'
import { t } from '../test.js'
import { Queue } from '../../src/pool.js'

const gc = globalThis.Bun ? () => globalThis.Bun.gc(true) : (v8.setFlagsFromString('--expose-gc'), vm.runInNewContext('gc'))

t('Queue hands items back in order across compaction', async() => {
  const q = Queue()
      , out = []
  for (let i = 0; i < 5000; i++) {
    q.push(i)
    i % 3 === 0 && out.push(q.shift())
  }
  while (q.length)
    out.push(q.shift())
  return [true, out.length === 5000 && out.every((x, i) => x === i)]
})

t('Queue removes, peeks and takes what is left', async() => {
  const q = Queue()
  ;[1, 2, 3, 4].forEach(x => q.push(x))
  q.shift()
  const removed = q.remove(x => x === 3)
      , missing = q.remove(x => x === 9)
  return ['true false 2 2,4 0', [removed, missing, q.peek(), q.take().join(), q.length].join(' ')]
})

t('Queue shifts a long queue in linear time', async() => {
  const time = n => {
    const q = Queue()
    for (let i = 0; i < n; i++)
      q.push({ i })
    const start = performance.now()
    while (q.length)
      q.shift()
    return performance.now() - start
  }
  const best = n => Math.min(...[1, 2, 3, 4, 5].map(() => time(n)))
  time(50000)
  const small = Math.max(best(50000), 1)
      , large = best(400000)
  return [true, large < small * 30]
})

t('Queue stays small when items cycle through it without it ever draining (#747)', async() => {
  const q = Queue()
  q.push('a')
  q.push('b')
  q.push('c')
  for (let i = 0; i < 1000000; i++)
    q.push(q.shift())
  gc()
  const before = process.memoryUsage().heapUsed
  for (let i = 0; i < 1000000; i++)
    q.push(q.shift())
  gc()
  return ['3 true', q.length + ' ' + (process.memoryUsage().heapUsed - before < 1024 * 1024)]
})
