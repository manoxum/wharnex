import assert from 'node:assert/strict'
import test from 'node:test'
import { orchestratorBundleRepairPrompt } from './chat-agent-orchestrator-bundle-repair.mjs'

const filename = 'whx_bundle_res_otk-abc_req_20260927T170000_0123456789abcdef.zip'

test('a strict schema rejection yields a bounded repair instruction', () => {
  const prompt = orchestratorBundleRepairPrompt(new Error('orchestrator Worker worker-bundle HTTP 409: decode plan.json: json: unknown field "rationale"'), filename)
  assert.match(prompt, /campo não permitido "rationale"/)
  assert.ok(prompt.includes(filename))
  assert.equal(orchestratorBundleRepairPrompt(new Error('orchestrator Worker worker-bundle HTTP 409: decode plan.json: json: unknown field "<script>"'), filename), '')
  assert.equal(orchestratorBundleRepairPrompt(new Error('orchestrator Worker worker-bundle HTTP 500: internal'), filename), '')
})
