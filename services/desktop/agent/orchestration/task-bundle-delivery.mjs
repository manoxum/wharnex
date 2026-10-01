import path from 'node:path'
import { rm } from 'node:fs/promises'
import { postLongRunningWorkerJSON } from '../automation/chat-agent-long-request.mjs'
import { orchestratorBundleRejectionTerminal, orchestratorBundleRepairPrompt } from './chat-agent-orchestrator-bundle-repair.mjs'
import { sanitizeChatCacheKey } from '../../security/security.mjs'

const REPAIR_LIMIT = 3

export function createOrchestratorBundleDelivery({ backendURL, pendingDeliveries, acknowledge, scheduler, enqueue, canonicalURL, postLongRunning = postLongRunningWorkerJSON }) {
  const repairs = new Map()

  async function postTask(taskId, suffix, body, timeoutMs = 30_000) {
    const endpoint = `/api/orchestrator/tasks/${encodeURIComponent(taskId)}/${suffix}`
    if (suffix === 'bundle') {
      // Ingestion can exceed Node fetch's five-minute header deadline.
      try {
        await postLongRunning(backendURL, endpoint, body)
        return { ok: true, status: 200, detail: '' }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const answered = message.match(/HTTP (\d{3})(?:: ([\s\S]*))?$/)
        return answered ? { ok: false, status: Number(answered[1]), detail: String(answered[2] || '') } : { ok: false, status: 0, detail: message }
      }
    }
    const response = await fetch(new URL(endpoint, backendURL), {
      method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    })
    let detail = ''
    if (!response.ok) try { detail = String((await response.json())?.error?.message || '') } catch { /* no JSON body */ }
    return { ok: response.ok, status: response.status, detail }
  }

  async function discard(requestId) {
    const record = pendingDeliveries.get(requestId)
    pendingDeliveries.delete(requestId)
    if (record?.filePath) await rm(record.filePath, { force: true }).catch(() => undefined)
  }

  async function deliverOrchestratorTaskBundle(taskId, payload, attempt = 0) {
    const key = sanitizeChatCacheKey(payload?.cacheKey || taskId)
    const requestId = String(payload?.requestId || '')
    const filename = path.basename(String(payload?.filename || ''))
    let result
    try { result = await postTask(taskId, 'bundle', { filename, content_base64: payload.contentBase64 }) }
    catch (error) { result = { ok: false, status: 0, detail: error instanceof Error ? error.message : String(error) } }
    if (result.ok) {
      repairs.delete(requestId)
      await acknowledge(key, requestId, filename).catch((error) => console.warn(`[orchestrator-delivery] ack failed task=${taskId}: ${error instanceof Error ? error.message : String(error)}`))
      console.log(`[orchestrator-delivery] delivered task=${taskId} request=${requestId}`)
      return
    }
    if (result.status === 0 || result.status >= 500) {
      const delayMs = Math.min(5 * 60_000, 15_000 * 2 ** attempt)
      console.warn(`[orchestrator-delivery] retry task=${taskId} request=${requestId} status=${result.status} in=${delayMs}ms detail=${result.detail.slice(0, 200)}`)
      if (attempt < 8) setTimeout(() => { void deliverOrchestratorTaskBundle(taskId, payload, attempt + 1) }, delayMs)
      return
    }
    const rejection = new Error(`orchestrator Worker worker-bundle HTTP ${result.status}: ${result.detail}`)
    await discard(requestId)
    if (!orchestratorBundleRejectionTerminal(rejection)) {
      console.warn(`[orchestrator-delivery] stale task=${taskId} request=${requestId} detail=${result.detail.slice(0, 200)}`)
      return
    }
    const repairCount = repairs.get(requestId) || 0
    const correction = orchestratorBundleRepairPrompt(rejection, filename)
    const listed = correction ? await scheduler().list({ request_id: requestId }).catch(() => ({ tasks: [] })) : { tasks: [] }
    const supervision = (listed?.tasks || []).filter((item) => item.type === 'AWAIT_RESPONSE').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]
    const conversationURL = canonicalURL(supervision?.payload?.conversation_url || '')
    const sessionID = String(supervision?.payload?.session_id || supervision?.session_id || '')
    if (correction && repairCount < REPAIR_LIMIT && conversationURL) {
      repairs.set(requestId, repairCount + 1)
      await enqueue('RECOVERY_WRITE', {
        key, requestId, rootRequestId: requestId, conversationURL, sessionID,
        dedupeKey: `task-bundle-repair:${requestId}:${repairCount + 1}`, maxAttempts: 4,
        payload: { prompt: correction, original_prompt: correction, session_id: sessionID, workspace_chat_id: '' },
      })
      console.warn(`[orchestrator-delivery] repair task=${taskId} request=${requestId} count=${repairCount + 1}`)
      return
    }
    repairs.delete(requestId)
    const failed = await postTask(taskId, 'fail-run', { error: rejection.message.slice(0, 1500) }).catch(() => ({ ok: false }))
    console.warn(`[orchestrator-delivery] failed-run task=${taskId} request=${requestId} recorded=${failed.ok === true} detail=${result.detail.slice(0, 200)}`)
  }

  return { deliverOrchestratorTaskBundle }
}
