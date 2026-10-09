import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createFileTail } from './file-tail.mjs'

test('incremental tail preserves UTF-8, every line and incomplete writes', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wharnex-splash-tail-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'output')
  await writeFile(file, 'área 😊\nsecond\nlast')
  const read = createFileTail(file, { chunkBytes: 5 })
  const rows = []
  let result
  do { result = read(); rows.push(...result.lines) } while (!result.caughtUp)
  assert.deepEqual(rows, ['área 😊', 'second'])
  await appendFile(file, ' line\n')
  do { result = read(); rows.push(...result.lines) } while (!result.caughtUp)
  assert.deepEqual(rows, ['área 😊', 'second', 'last line'])
  assert.deepEqual(read().lines, [])
})

test('skips old Desktop output but observes a rewritten log before the first read', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wharnex-splash-tail-reset-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'desktop')
  await writeFile(file, 'old\n')
  const read = createFileTail(file, { startAtEnd: true })
  await writeFile(file, 'new startup is longer\n')
  assert.deepEqual(read().lines, ['new startup is longer'])
})

test('a copy boundary finishes without following output appended after the gesture', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wharnex-splash-copy-boundary-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'output')
  await writeFile(file, 'captured before copy\n')
  const read = createFileTail(file)
  const end = read.boundary()
  await appendFile(file, 'captured afterwards\n')
  assert.deepEqual(read({ end }).lines, ['captured before copy'])
  assert.deepEqual(read().lines, ['captured afterwards'])
})
