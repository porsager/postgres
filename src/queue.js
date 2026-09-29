export default Queue

function Queue(initial = []) {
  let xs = initial.slice()
  let index = 0

  return {
    get length() {
      return xs.length - index
    },
    remove: (x) => {
      const i = xs.indexOf(x, index)
      return i === -1
        ? null
        : (xs.splice(i, 1), x)
    },
    push: (x) => (xs.push(x), x),
    shift: () => {
      const out = xs[index++]

      if (index === xs.length) {
        index = 0
        xs = []
      } else if (index > 64 && index * 2 >= xs.length) {
        xs = xs.slice(index)
        index = 0
      } else {
        xs[index - 1] = undefined
      }

      return out
    }
  }
}
