import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { captureStartup } from './capture.mjs'
import { createSplashOutputReader } from './reader.mjs'
import { copySplashOutput } from './clipboard.mjs'

test('retains and copies every startup line across commands, including the first', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wharnex-splash-history-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const outputFile = path.join(directory, 'startup.output')
  const output = { write() {} }
  await captureStartup(process.execPath, ['-e', "for(let i=0;i<400;i++) console.log('step '+i)"], { file: outputFile, stdout: output, stderr: output })
  await captureStartup(process.execPath, ['-e', "process.stderr.write('failure detail')"], { file: outputFile, stdout: output, stderr: output })
  await captureStartup(process.execPath, ['-e', "console.log('next command')"], { file: outputFile, stdout: output, stderr: output })
  const read = createSplashOutputReader({ outputFile, environment: {} })
  const rows = read({ drain: true })
  assert.equal(rows.length, 402)
  assert.equal(rows[0].text, 'step 0')
  assert.equal(rows[400].text, 'failure detail')
  assert.equal(rows.at(-1).text, 'next command')
  let copied = ''
  assert.equal(copySplashOutput({ writeText(text) { copied = text } }, rows), true)
  assert.equal(copied.split('\n').length, 402)
  assert.match(copied, /step 0/)
  assert.match(copied, /next command$/)
})

test('retains large redacted history beyond the old one-megabyte cutoff', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wharnex-splash-large-history-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const outputFile = path.join(directory, 'startup.output')
  const output = { write() {} }
  await captureStartup(process.execPath, ['-e', "for(let i=0;i<2500;i++) console.log(i+' '+'.'.repeat(500)+' TOKEN=private-value')"], { file: outputFile, stdout: output, stderr: output })
  const rows = createSplashOutputReader({ outputFile, environment: {} })({ drain: true })
  assert.equal(rows.length, 2500)
  assert.match(rows[0].text, /^0 /)
  assert.match(rows.at(-1).text, /^2499 /)
  assert.doesNotMatch(JSON.stringify(rows), /private-value/)
})

test('keeps blank lines without adding a phantom line at command completion', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wharnex-splash-blank-lines-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const outputFile = path.join(directory, 'startup.output')
  const output = { write() {} }
  await captureStartup(process.execPath, ['-e', "process.stdout.write('first\\n\\nlast\\n')"], { file: outputFile, stdout: output, stderr: output })
  const rows = createSplashOutputReader({ outputFile, environment: {} })({ drain: true })
  assert.deepEqual(rows.map((row) => row.text), ['first', '', 'last'])
})
