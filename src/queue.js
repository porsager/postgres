export default Queue

function Queue(initial = []) {
  let xs = initial.slice()
  let offset = 0

  return {
    get length() {
      return xs.length - offset
    },
    remove: (x) => {
      const index = xs.indexOf(x, offset)
      return index === -1
        ? null
        : (xs.splice(index, 1), x)
    },
    push: (x) => (xs.push(x), x),
    shift: () => {
      const out = xs[offset++]

      if (offset === xs.length) {
        offset = 0
        xs = []
      } else {
        xs[offset - 1] = undefined
      }

      return out
    }
  }
}
