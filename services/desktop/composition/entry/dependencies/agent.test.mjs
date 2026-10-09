import assert from 'node:assert/strict'
import test from 'node:test'
import { createAgentDependencies } from './agent.mjs'

test('agent composition exposes every UI discovery bundle dependency', () => {
  const dependencies = createAgentDependencies()

  assert.equal(typeof dependencies.uiTestingDiscoveryFilename, 'function')
  assert.equal(
    dependencies.uiTestingDiscoveryFilename(`cat_${'a'.repeat(20)}`),
    `whx_ui_test_discovery_res_cat_${'a'.repeat(20)}.zip`,
  )
})
