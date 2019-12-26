module.exports = Queue

function Queue() {
  let xs = []
  let index = 0

  return {
    get length() {
      return xs.length - index
    },
    push: (x) => xs.push(x),
    peek: () => xs[index],
    shift: () => {
      const out = xs[index++]

      if (index === xs.length) {
        index = 0
        xs = []
      } else {
        xs[index - 1] = undefined
      }

      return out
    }
  }
}
