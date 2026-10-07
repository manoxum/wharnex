import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { captureStartup } from './capture.mjs'

test('captures both streams live, preserves output and exit code, and redacts split secrets', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wharnex-splash-output-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'output.json')
  let stdout = ''; let stderr = ''
  let finished = false
  const completion = captureStartup(process.execPath, ['-e', `
    process.stdout.write('Compiling frontend\\n')
    process.stderr.write('Warning: dependency\\nAPI_TOKEN=')
    setTimeout(() => { process.stderr.write('private-value\\n'); process.exitCode = 7 }, 500)
  `], { file, environment: { ...process.env, API_TOKEN: 'private-value' }, stdout: { write: (s) => { stdout += s } }, stderr: { write: (s) => { stderr += s } } })
  completion.then(() => { finished = true })
  let live = ''
  for (let attempt = 0; attempt < 40; attempt++) {
    try { live = await readFile(file, 'utf8') } catch { /* capture has not flushed yet */ }
    if (live.includes('Compiling frontend')) break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.match(live, /Compiling frontend/)
  assert.equal(finished, false, 'output must appear while startup is still running')
  assert.equal(await completion, 7)
  assert.equal(stdout, 'Compiling frontend\n')
  assert.match(stderr, /API_TOKEN=private-value/)
  const rows = (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  assert.deepEqual(rows.map((row) => row.stream), ['stdout', 'stderr', 'stderr'])
  assert.match(rows.at(-1).text, /\[REDACTED\]/)
  assert.doesNotMatch(JSON.stringify(rows), /private-value/)
})

test('broken display output does not fail a successful command', async () => {
  const output = { write() {} }
  assert.equal(await captureStartup(process.execPath, ['-e', "console.log('ready')"], { file: '/nonexistent/wharnex-splash/output', stdout: output, stderr: output }), 0)
})

test('captures every output line and incomplete final lines', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wharnex-splash-output-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'output.json')
  const output = { write() {} }
  await captureStartup(process.execPath, ['-e', "for(let i=0;i<200;i++) console.log('step '+i);process.stderr.write('final failure')"], { file, stdout: output, stderr: output })
  const rows = (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  assert.equal(rows.length, 201)
  assert.equal(rows.at(-1).text, 'final failure')
  assert.equal(rows[0].text, 'step 0')
})
