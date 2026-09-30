import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { parseBundleName } from '../../transport/bundlename.mjs'
import { normalizeOrchestratorResultFilename } from '../../agent/orchestration/chat-agent-orchestrator-request.mjs'

const ORCHESTRATOR_PLAN_INBOX_MAX = 16
const ORCHESTRATOR_PLAN_INBOX_TTL_MS = 6 * 60 * 60 * 1000

export function createOrchestratorPlanDownloads({
  expectedChatGPTOrchestratorPlans, tempPath,
  MAX_ORCHESTRATOR_PLAN_BYTES, ORCHESTRATOR_PLAN_TIMEOUT_MS,
}) {
  const chatGPTOrchestratorPlanInbox = new Map()

  function orchestratorPlanInboxDirectory() {
    return path.join(tempPath(), 'wharness-orchestrator-plans', 'inbox')
  }

  function pruneChatGPTOrchestratorPlanInbox(now = Date.now()) {
    for (const [name, entry] of [...chatGPTOrchestratorPlanInbox]) {
      if (now - Number(entry?.receivedAt || 0) <= ORCHESTRATOR_PLAN_INBOX_TTL_MS) continue
      chatGPTOrchestratorPlanInbox.delete(name)
      void rm(entry.savePath, { force: true }).catch(() => undefined)
    }
    while (chatGPTOrchestratorPlanInbox.size > ORCHESTRATOR_PLAN_INBOX_MAX) {
      const [name, entry] = chatGPTOrchestratorPlanInbox.entries().next().value
      chatGPTOrchestratorPlanInbox.delete(name)
      void rm(entry.savePath, { force: true }).catch(() => undefined)
    }
  }

  // Keep an artifact that nothing is waiting for, instead of cancelling it. The
  // filename carries its own task id, so a retained plan can only ever be claimed
  // by the attempt it belongs to.
  function retainChatGPTOrchestratorPlanDownload(item, filename) {
    // Either shape is self-identifying: the legacy artifact carries its task id,
    // the bundle carries its request id. Neither can be claimed by another task.
    const taskId = String(filename.match(/^whx_orchestrator_plan_(cat_[a-f0-9]{20})\.json$/)?.[1] || '')
      || String(parseBundleName(filename)?.requestId || '')
    if (!taskId) {
      item.cancel()
      return true
    }
    if (Number(item.getTotalBytes?.() || 0) > MAX_ORCHESTRATOR_PLAN_BYTES) {
      item.cancel()
      return true
    }
    const savePath = path.join(orchestratorPlanInboxDirectory(), filename)
    try {
      mkdirSync(orchestratorPlanInboxDirectory(), { recursive: true, mode: 0o700 })
      item.setSavePath(savePath)
    } catch (error) {
      item.cancel()
      console.warn(`[orchestrator-worker] could not retain unclaimed plan ${filename}: ${error instanceof Error ? error.message : String(error)}`)
      return true
    }
    item.on('updated', () => {
      if (item.getReceivedBytes() > MAX_ORCHESTRATOR_PLAN_BYTES) item.cancel()
    })
    item.once('done', (_doneEvent, state) => {
      if (state !== 'completed') {
        void rm(savePath, { force: true }).catch(() => undefined)
        return
      }
      chatGPTOrchestratorPlanInbox.set(filename, { taskId, savePath, receivedAt: Date.now() })
      pruneChatGPTOrchestratorPlanInbox()
      console.log(`[orchestrator-worker] retained unclaimed plan task=${taskId} file=${filename}`)
    })
    return true
  }

  // Claim a retained artifact for the attempt that owns it, if one is waiting.
  async function takeRetainedChatGPTOrchestratorPlan(filename) {
    pruneChatGPTOrchestratorPlanInbox()
    const entry = chatGPTOrchestratorPlanInbox.get(filename)
    if (!entry) return ''
    chatGPTOrchestratorPlanInbox.delete(filename)
    try {
      const bytes = await readFile(entry.savePath)
      if (bytes.byteLength > MAX_ORCHESTRATOR_PLAN_BYTES) throw new Error('Orchestrator plan exceeds the 2 MiB result limit')
      return bytes
    } catch (error) {
      console.warn(`[orchestrator-worker] retained plan ${filename} was unusable: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    } finally {
      await rm(entry.savePath, { force: true }).catch(() => undefined)
    }
  }

  function registerChatGPTOrchestratorPlanDownload(item, sourceFilename) {
    const filename = normalizeOrchestratorResultFilename(sourceFilename)
    const expected = expectedChatGPTOrchestratorPlans.get(filename)
    const parsedBundle = parseBundleName(filename)
    const looksInternal = /^whx_orchestrator_plan_cat_[a-f0-9]{20}\.json$/.test(filename)
      || (parsedBundle?.chatId === 'orchestrator' && parsedBundle?.kind === 'res')
    if (!expected && !looksInternal) return false
    if (!expected || Date.now() - expected.armedAt > ORCHESTRATOR_PLAN_TIMEOUT_MS + 60_000) {
      return retainChatGPTOrchestratorPlanDownload(item, filename)
    }
    expected.downloadStarted = true
    const total = Number(item.getTotalBytes?.() || 0)
    if (total > MAX_ORCHESTRATOR_PLAN_BYTES) {
      item.cancel()
      expected.reject(new Error('Orchestrator plan exceeds the 2 MiB result limit'))
      return true
    }
    const dir = path.join(tempPath(), 'wharness-orchestrator-plans', expected.taskId)
    const savePath = path.join(dir, filename)
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      item.setSavePath(savePath)
    } catch (error) {
      item.cancel()
      expected.reject(error instanceof Error ? error : new Error(String(error)))
      return true
    }
    item.on('updated', () => {
      if (item.getReceivedBytes() > MAX_ORCHESTRATOR_PLAN_BYTES) {
        item.cancel()
        expected.reject(new Error('Orchestrator plan exceeds the 2 MiB result limit'))
      }
    })
    item.once('done', async (_doneEvent, state) => {
      if (state !== 'completed') {
        if (state !== 'cancelled') expected.reject(new Error(`Orchestrator plan download ended in state ${state}`))
        return
      }
      try {
        const bytes = await readFile(savePath)
        if (bytes.byteLength > MAX_ORCHESTRATOR_PLAN_BYTES) throw new Error('Orchestrator plan exceeds the 2 MiB result limit')
        expected.resolve(bytes)
      } catch (error) {
        expected.reject(error instanceof Error ? error : new Error(String(error)))
      } finally {
        await rm(savePath, { force: true }).catch(() => undefined)
      }
    })
    return true
  }

  return { registerChatGPTOrchestratorPlanDownload, takeRetainedChatGPTOrchestratorPlan }
}
