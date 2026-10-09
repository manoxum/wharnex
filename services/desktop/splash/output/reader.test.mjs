import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createSplashOutputReader } from './reader.mjs'

test('reads current startup and Desktop output, skipping history and handling truncation', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wharnex-splash-reader-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const outputFile = path.join(directory, 'output.json')
  const desktopFile = path.join(directory, 'desktop.log')
  await writeFile(desktopFile, 'old historical output\n')
  const read = createSplashOutputReader({ outputFile, desktopFile, environment: {} })
  await writeFile(outputFile, [{ stream: 'stdout', text: 'building', source: 'make', at: '2026-10-06T10:00:00Z' }, { stream: 'stderr', text: 'TOKEN=secret-value', source: 'make', at: '2026-10-06T10:00:01Z' }].map((row) => JSON.stringify(row)).join('\n') + '\n')
  await appendFile(desktopFile, 'Desktop ready\n')
  let rows = read()
  assert.equal(rows.length, 3)
  assert.ok(rows.some((row) => row.text === 'Desktop ready'))
  assert.doesNotMatch(JSON.stringify(rows), /historical|secret-value/)
  await writeFile(desktopFile, 'new Desktop boot\n')
  rows = read()
  assert.ok(rows.some((row) => row.text === 'new Desktop boot'))
  assert.ok(rows.some((row) => row.text === 'Desktop ready'), 'rotation must preserve captured startup history')
  await writeFile(outputFile, 'malformed')
  assert.doesNotThrow(read)
})
