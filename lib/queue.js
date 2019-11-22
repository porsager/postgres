export default function Queue() {
  let xs = []
  let index = 0

  return {
    get length() {
      return xs.length - index
    },
    push: (x) => xs.push(x),
    shift: () => {
      if (index === xs.length) {
        index = -1
        xs = []
      } else if (index > 0) {
        xs[index - 1] = undefined
      }

      return xs[index++]
    }
  }
}
