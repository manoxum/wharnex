import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

test('cached rollout checks init, shutdown grace, image identity and existing health probes', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'wharnex-stack-readiness-'))
  const source = fileURLToPath(new URL('./readiness.sh', import.meta.url))
  try {
    writeFileSync(path.join(root, 'docker'), '#!/bin/sh\nprintf "%s\\n" "$PROCESS_CONTRACT"\n', { mode: 0o700 })
    const run = (contract, health = '0', desired = 'backend') => spawnSync('sh', ['-c',
      '. "$1"; service_ready() { return "$TEST_HEALTH"; }; application_runtime_ready container backend "$2" frontend frontend webapp webapp',
      'probe', source, desired,
    ], { env: { ...process.env, PATH: `${root}:${process.env.PATH}`, PROCESS_CONTRACT: contract, TEST_HEALTH: health } })
    assert.equal(run('true 30').status, 0)
    assert.equal(run('<nil> 30').status, 1, 'same images cannot retain the zombie-producing backend')
    assert.equal(run('true 10').status, 1, 'same images cannot retain the short log-drain grace')
    assert.equal(run('true 30', '1').status, 1, 'existing service health still gates the shortcut')
    assert.equal(run('true 30', '0', 'different-backend').status, 1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
