import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
    , src = path.join(root, 'src') + path.sep
    , dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-'))
    , suites = process.argv.slice(2).filter(x => !x.startsWith('--'))
    , lines = process.argv.includes('--lines')
    , minimum = +process.env.COVERAGE_MIN || 0

const failed = (suites.length ? suites : ['tests/unit', 'tests/index.js', 'tests/simulate.js']).filter(suite =>
  spawnSync(process.execPath, [path.join(root, suite)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_V8_COVERAGE: dir }
  }).status !== 0
)

const files = {}

fs.readdirSync(dir).forEach(name =>
  JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')).result.forEach(script => {
    const file = script.url.startsWith('file://') && fileURLToPath(script.url)
    if (!file || !file.startsWith(src))
      return

    const code = fs.readFileSync(file, 'utf8')
        , counts = new Int32Array(code.length)
        , ranges = script.functions.flatMap(fn => fn.ranges).sort((a, b) => (b.endOffset - b.startOffset) - (a.endOffset - a.startOffset))
    ranges.forEach(({ startOffset, endOffset, count }) => counts.fill(count, startOffset, endOffset))
    const seen = files[file] || (files[file] = { code, covered: new Uint8Array(code.length) })
    counts.forEach((count, i) => count > 0 && (seen.covered[i] = 1))
  })
)

fs.rmSync(dir, { recursive: true, force: true })

let total = 0
  , hit = 0

const rows = Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([file, { code, covered }]) => {
  const missing = []
  let offset = 0
    , count = 0
    , ok = 0
  code.split('\n').forEach((line, i) => {
    const start = offset
    offset += line.length + 1
    if (!line.trim())
      return

    count++
    let used = false
    for (let j = start; j < start + line.length && !used; j++)
      used = covered[j] === 1 && line[j - start] !== ' '
    used ? ok++ : missing.push(i + 1)
  })
  total += count
  hit += ok
  return { file: path.relative(root, file), percent: ok / count * 100, missing }
})

console.log('\nCoverage of src by line')
rows.forEach(({ file, percent, missing }) => {
  console.log(file.padEnd(22) + percent.toFixed(2).padStart(7) + '%' + (lines && missing.length ? '  ' + spans(missing) : ''))
})

const percent = hit / total * 100
console.log('total'.padEnd(22) + percent.toFixed(2).padStart(7) + '%')

process.env.GITHUB_ACTIONS && console.log(
  '::' + (minimum && percent < minimum ? 'error' : 'notice') + ' title=Coverage::'
  + percent.toFixed(2) + '% of lines in src' + (minimum ? ', minimum ' + minimum + '%' : '')
)

process.env.GITHUB_STEP_SUMMARY && fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
  '| File | Lines | Not covered |',
  '| --- | ---: | --- |',
  ...rows.map(x => '| ' + x.file + ' | ' + x.percent.toFixed(2) + '% | ' + spans(x.missing) + ' |'),
  '| **total** | **' + percent.toFixed(2) + '%** | |',
  ''
].join('\n'))

if (failed.length)
  console.log('Failed: ' + failed.join(', '))
if (minimum && percent < minimum)
  console.log('Coverage is below ' + minimum + '%')

process.exitCode = failed.length || (minimum && percent < minimum) ? 1 : 0

function spans(xs) {
  const out = []
  xs.forEach(x => {
    const last = out[out.length - 1]
    last && last[1] === x - 1 ? last[1] = x : out.push([x, x])
  })
  return out.map(([a, b]) => a === b ? a : a + '-' + b).join(',')
}
