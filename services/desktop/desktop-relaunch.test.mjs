import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const helper = fileURLToPath(new URL('../../scripts/desktop-relaunch.sh', import.meta.url))

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('Desktop self-evolution relaunch waits for the old coordinator before start.sh', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wharnex-desktop-relaunch-'))
  const scripts = path.join(root, 'scripts')
  const marker = path.join(root, 'started.txt')
  await mkdir(scripts, { recursive: true })
  const start = path.join(scripts, 'start.sh')
  await writeFile(start, '#!/bin/sh\nprintf "started\\n" > "$WHARNESS_ROOT/started.txt"\n', { mode: 0o700 })
  await chmod(start, 0o700)

  const blocker = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' })
  const relaunch = spawn(helper, [root, String(blocker.pid)], { stdio: 'ignore' })
  try {
    await delay(180)
    assert.equal(existsSync(marker), false, 'start.sh must not run while the old coordinator is alive')
    blocker.kill('SIGTERM')
    const [code] = await once(relaunch, 'exit')
    assert.equal(code, 0)
    assert.equal((await readFile(marker, 'utf8')).trim(), 'started')
  } finally {
    try { blocker.kill('SIGKILL') } catch { /* already exited */ }
    try { relaunch.kill('SIGKILL') } catch { /* already exited */ }
    await rm(root, { recursive: true, force: true })
  }
})
