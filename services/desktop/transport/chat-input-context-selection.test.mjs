import assert from 'node:assert/strict'
import test from 'node:test'
import { selectArchiveContextEntries } from './chat-input-context-selection.mjs'

const entry = (name) => ({ name, bytes: Buffer.from(name) })

test('Partial selection carries every selected body with no path-count ceiling', () => {
  const selected = Array.from({ length: 200 }, (_, index) => `context/SoT/doc-${index}.md`)
  const entries = [...selected, 'context/main.txt', 'metadata/context-sources.json'].map(entry)
  const names = selectArchiveContextEntries(entries, { mode: 'partial', paths: selected }).map((item) => item.name)
  assert.equal(names.length, 201)
  assert.ok(names.includes('metadata/context-sources.json'))
  assert.ok(!names.includes('context/main.txt'))
})

test('Partial selection still rejects duplicates and paths outside the snapshot', () => {
  const entries = [entry('context/AGENTS.md')]
  assert.throws(() => selectArchiveContextEntries(entries, { mode: 'partial', paths: ['context/AGENTS.md', 'context/AGENTS.md'] }))
  assert.throws(() => selectArchiveContextEntries(entries, { mode: 'partial', paths: ['context/missing.md'] }))
})
