import test from 'node:test'
import assert from 'node:assert/strict'
import { loadConfigFromFile } from '../../services/frontend/node_modules/vite/dist/node/index.js'

test('frontend tests retain isolation and discovery with a bounded worker pool', async () => {
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' },
    new URL('../../services/frontend/vite.config.ts', import.meta.url).pathname)
  assert.ok(loaded)
  assert.equal(loaded.config.test.maxWorkers, 2, 'tests must leave capacity for the live workbench')
  assert.equal(loaded.config.test.minWorkers, 1)
  assert.notEqual(loaded.config.test.isolate, false, 'resource bounds must preserve test isolation')
  assert.deepEqual(loaded.config.test.include, ['src/**/*.test.{ts,tsx}'])
})
