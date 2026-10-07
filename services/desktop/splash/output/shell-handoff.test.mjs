import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
test('direct-start helper captures both streams once across nested launcher handoff', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wharnex-splash-handoff-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'output.json')
  await writeFile(file, '')
  const childScript = path.join(directory, 'nested-start.sh')
  await writeFile(childScript, `
    . "$ROOT/scripts/splash-lib.sh"
    wharnex_splash_run node -e 'console.log("stdout step"); console.error("stderr step"); process.exitCode=7'
  `)
  const result = spawnSync('sh', ['-c', `
    . "$ROOT/scripts/splash-lib.sh"
    wharnex_splash_run sh "$WHARNEX_TEST_CHILD"
  `], { env: { ...process.env, ROOT: root, WHARNEX_SPLASH_OUTPUT_FILE: file, WHARNEX_TEST_CHILD: childScript }, encoding: 'utf8' })
  assert.equal(result.status, 7, result.stderr)
  assert.match(result.stdout, /stdout step/)
  assert.match(result.stderr, /stderr step/)
  const rows = (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  assert.deepEqual(rows.map((row) => row.stream), ['stdout', 'stderr'])
})

test('a failed splash stays alive with its diagnostic files until the window closes', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wharnex-splash-failure-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const status = path.join(directory, 'status')
  await writeFile(status, 'Starting')
  const result = spawnSync('sh', ['-c', `
    . "$ROOT/scripts/splash-lib.sh"
    sleep 10 >/dev/null 2>&1 &
    WHARNEX_SPLASH_PID=$!
    trap 'kill "$WHARNEX_SPLASH_PID" 2>/dev/null || true' EXIT
    wharnex_splash_show_failure
    wharnex_splash_close
    kill -0 "$WHARNEX_SPLASH_PID"
  `], { env: { ...process.env, ROOT: root, WHARNESS_SPLASH_STATUS_FILE: status }, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(await readFile(status, 'utf8'), /não iniciou/)
  assert.equal(await readFile(`${status}.failed`, 'utf8'), '')
})
