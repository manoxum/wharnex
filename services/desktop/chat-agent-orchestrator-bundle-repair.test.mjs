import assert from 'node:assert/strict'
import test from 'node:test'
import { orchestratorBundleRejectionTerminal, orchestratorBundleRepairPrompt } from './chat-agent-orchestrator-bundle-repair.mjs'

const filename = 'whx_bundle_res_otk-abc_req_20260927T170000_0123456789abcdef.zip'

test('a strict schema rejection yields a bounded repair instruction', () => {
  const prompt = orchestratorBundleRepairPrompt(new Error('orchestrator Worker worker-bundle HTTP 409: decode plan.json: json: unknown field "rationale"'), filename)
  assert.match(prompt, /campo não permitido "rationale"/)
  assert.ok(prompt.includes(filename))
  assert.equal(orchestratorBundleRepairPrompt(new Error('orchestrator Worker worker-bundle HTTP 409: decode plan.json: json: unknown field "<script>"'), filename), '')
  assert.equal(orchestratorBundleRepairPrompt(new Error('orchestrator Worker worker-bundle HTTP 500: internal'), filename), '')
})

test('knowledge path rejections are repairable with only validator tokens', () => {
  const rejected = (detail) => new Error(`orchestrator Worker worker-bundle HTTP 409: ${detail}`)
  const wrongPath = orchestratorBundleRepairPrompt(rejected('knowledge "agent-queue-composer-drafts" must use file knowledge/agent-queue-composer-drafts.md'), filename)
  assert.match(wrongPath, /"agent-queue-composer-drafts" com um caminho errado/)
  assert.match(wrongPath, /exatamente knowledge\/agent-queue-composer-drafts\.md/)
  assert.match(orchestratorBundleRepairPrompt(rejected('knowledge "notes" references missing knowledge/notes.md'), filename), /não contém knowledge\/notes\.md/)
  assert.match(orchestratorBundleRepairPrompt(rejected('knowledge "notes" is empty'), filename), /"notes" está vazia/)
  // Anything outside the bounded token shapes never reaches ChatGPT.
  assert.equal(orchestratorBundleRepairPrompt(rejected('knowledge "Bad Id" must use file knowledge/x.md'), filename), '')
})

test('a rejection no prompt can fix ends the run instead of re-submitting the same ZIP', () => {
  const rejected = (detail) => new Error(`orchestrator Worker worker-bundle HTTP 409: ${detail}`)
  assert.equal(orchestratorBundleRejectionTerminal(rejected('stale command plan cannot be reconciled without its immutable request base; submit one fresh request')), true)
  assert.equal(orchestratorBundleRejectionTerminal(rejected('orchestrator Worker bundle does not match the active Agent request')), false)
  assert.equal(orchestratorBundleRejectionTerminal(new Error('orchestrator Worker worker-bundle HTTP 502: bad gateway')), false)
})
