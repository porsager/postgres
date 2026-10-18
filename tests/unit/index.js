import { t } from '../test.js'

t.ready = Promise.all(['protocol', 'socket', 'types', 'build', 'errors', 'pool', 'options'].map(area =>
  import('./' + area + '.js').catch(error =>
    t(area + ' loads', async() => { throw error })
  )
)).then(() => new Promise(r => setTimeout(r)))
