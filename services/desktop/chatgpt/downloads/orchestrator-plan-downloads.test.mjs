import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createOrchestratorPlanDownloads } from './orchestrator-plan-downloads.mjs'

test('an unclaimed orchestrator plan waits in the bounded inbox for its owner', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wharnex-plan-downloads-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const filename = `whx_orchestrator_plan_cat_${'a'.repeat(20)}.json`
  const downloads = createOrchestratorPlanDownloads({
    expectedChatGPTOrchestratorPlans: new Map(), tempPath: () => dir,
    MAX_ORCHESTRATOR_PLAN_BYTES: 1024, ORCHESTRATOR_PLAN_TIMEOUT_MS: 60_000,
  })
  const item = new EventEmitter()
  item.getTotalBytes = () => 4
  item.setSavePath = (value) => { item.savePath = value }
  item.cancel = () => { throw new Error('valid unclaimed plan was cancelled') }

  assert.equal(downloads.registerChatGPTOrchestratorPlanDownload(item, filename), true)
  await writeFile(item.savePath, 'plan')
  item.emit('done', undefined, 'completed')
  assert.equal((await downloads.takeRetainedChatGPTOrchestratorPlan(filename)).toString(), 'plan')
  assert.equal(await downloads.takeRetainedChatGPTOrchestratorPlan(filename), '')
})
