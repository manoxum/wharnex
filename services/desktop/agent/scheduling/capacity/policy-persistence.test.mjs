import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createChatAgentPolicyStore } from './policy-persistence.mjs'

test('legacy policy state migrates to suspended workers and persists version 2 privately', () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'wharnex-agent-policy-'))
  try {
    const file = path.join(userData, 'chat-agent-policies-v1.json')
    writeFileSync(file, JSON.stringify({ version: 1, workers_suspended: false, keep_flowing_global: true }))
    let current
    const store = createChatAgentPolicyStore({ userDataPath: () => userData, policies: () => current })
    current = store.load()
    assert.equal(current.workers_suspended, true)
    assert.equal(current.keep_flowing_global, true)
    assert.ok(current.workers_suspended_types.includes('ORGANIZE_CHAT'))
    rmSync(file)
    store.persist()
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, 2)
    assert.equal(statSync(file).mode & 0o777, 0o600)
  } finally { rmSync(userData, { recursive: true, force: true }) }
})

test('missing or malformed policy state loads defaults without crashing', () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'wharnex-agent-policy-'))
  try {
    const store = createChatAgentPolicyStore({ userDataPath: () => userData, policies: () => ({}) })
    assert.equal(store.load().workers_suspended, true)
    writeFileSync(path.join(userData, 'chat-agent-policies-v1.json'), '{')
    assert.equal(store.load().workers_suspended, true)
  } finally { rmSync(userData, { recursive: true, force: true }) }
})
