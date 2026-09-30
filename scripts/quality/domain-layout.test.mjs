import test from 'node:test'
import assert from 'node:assert/strict'
import { domainLayoutViolation, overfullDirectoryViolations } from './domain-layout.mjs'

test('new implementation and tests require a named domain directory', () => {
  assert.match(domainLayoutViolation('services/desktop/random-helper.mjs'), /named domain/)
  assert.match(domainLayoutViolation('services/desktop/utils/random.mjs'), /named domain/)
  assert.match(domainLayoutViolation('services/desktop/chatgpt/misc/random.mjs'), /subdomain/)
  assert.match(domainLayoutViolation('services/frontend/src/components/Panel.tsx'), /domain/)
  assert.match(domainLayoutViolation('services/backend/internal/root.go'), /internal/)
  assert.match(domainLayoutViolation('scripts/new-gate.sh'), /named domain/)
  assert.match(domainLayoutViolation('services/frontend/src/agent/helpers/state.ts'), /subdomain/)
  assert.match(domainLayoutViolation('services/frontend/src/styles/domains/git-panel.css'), /named surface/)
  assert.equal(domainLayoutViolation('services/desktop/window/layout.mjs'), '')
  assert.equal(domainLayoutViolation('services/desktop/window/layout.test.mjs'), '')
  assert.equal(domainLayoutViolation('services/backend/internal/orchestrator/task.go'), '')
  assert.equal(domainLayoutViolation('services/frontend/src/components/agent/Panel.tsx'), '')
  assert.equal(domainLayoutViolation('services/frontend/src/styles/domains/git/review.css'), '')
  assert.equal(domainLayoutViolation('scripts/quality/domain-layout.mjs'), '')
})

test('entry points and non-implementation files keep their required locations', () => {
  assert.equal(domainLayoutViolation('services/desktop/main.mjs'), '')
  assert.equal(domainLayoutViolation('services/desktop/preload.cjs'), '')
  assert.equal(domainLayoutViolation('services/frontend/src/main.tsx'), '')
  assert.equal(domainLayoutViolation('SoT/PROJECT_STRUCTURE.md'), '')
  assert.equal(domainLayoutViolation('services/desktop/package.json'), '')
})

test('new work cannot enlarge a directory beyond twenty source and test files', () => {
  const directory = 'services/desktop/agent/scheduling'
  const files = Array.from({ length: 21 }, (_, index) => `${directory}/part-${index}.mjs`)
  assert.deepEqual(overfullDirectoryViolations([files[20]], files), [{
    file: directory,
    reason: '21 implementation and test files exceed the 20-file subdomain limit',
  }])
  assert.deepEqual(overfullDirectoryViolations([files[19]], files.slice(0, 20)), [])
  assert.deepEqual(overfullDirectoryViolations([`${directory}/README.md`], files), [])
  assert.deepEqual(overfullDirectoryViolations([`${directory}/removed.mjs`], files), [])
})
