import test from 'node:test'
import assert from 'node:assert/strict'
import { domainLayoutViolation } from './domain-layout.mjs'

test('new implementation and tests require a named domain directory', () => {
  assert.match(domainLayoutViolation('services/desktop/random-helper.mjs'), /named domain/)
  assert.match(domainLayoutViolation('services/desktop/utils/random.mjs'), /named domain/)
  assert.match(domainLayoutViolation('services/frontend/src/components/Panel.tsx'), /domain/)
  assert.match(domainLayoutViolation('services/backend/internal/root.go'), /internal/)
  assert.match(domainLayoutViolation('scripts/new-gate.sh'), /named domain/)
  assert.equal(domainLayoutViolation('services/desktop/window/layout.mjs'), '')
  assert.equal(domainLayoutViolation('services/desktop/window/layout.test.mjs'), '')
  assert.equal(domainLayoutViolation('services/backend/internal/orchestrator/task.go'), '')
  assert.equal(domainLayoutViolation('services/frontend/src/components/agent/Panel.tsx'), '')
  assert.equal(domainLayoutViolation('scripts/quality/domain-layout.mjs'), '')
})

test('entry points and non-implementation files keep their required locations', () => {
  assert.equal(domainLayoutViolation('services/desktop/main.mjs'), '')
  assert.equal(domainLayoutViolation('services/desktop/preload.cjs'), '')
  assert.equal(domainLayoutViolation('services/frontend/src/main.tsx'), '')
  assert.equal(domainLayoutViolation('SoT/PROJECT_STRUCTURE.md'), '')
  assert.equal(domainLayoutViolation('services/desktop/package.json'), '')
})
