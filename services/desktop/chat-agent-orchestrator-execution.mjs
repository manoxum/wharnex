import { pollWorkerExpectedDownload } from './chat-agent-download-poll.mjs'
import { postLongRunningWorkerJSON } from './chat-agent-long-request.mjs'
import { orchestratorBundleRepairPrompt } from './chat-agent-orchestrator-bundle-repair.mjs'
import { chatGPTDeliveryContinuationPrompt } from './chatgpt-recovery.mjs'

const RESPONSE_TIMEOUT_MS = 8 * 60 * 1000
const POLL_MS = 2_000
// Same bound as an agentic Main Request's delivery continuations.
const MAX_DELIVERY_CONTINUATIONS = 2

async function workerRequest(baseURL, sessionID, taskID, suffix, body, postBundle = postLongRunningWorkerJSON) {
  const path = `/api/sessions/${encodeURIComponent(sessionID)}/orchestrator/tasks/${encodeURIComponent(taskID)}/${suffix}`
  if (suffix === 'worker-bundle') return postBundle(baseURL, path, body)
  const response = await fetch(new URL(path, baseURL), {
    method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!response.ok) {
    let detail = ''
    try { detail = String((await response.json())?.error?.message || '') } catch {}
    throw new Error(`orchestrator Worker ${suffix} HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
  }
  return response.json()
}

function activeRequest(value) {
  return value?.task?.status === 'DOING' && Boolean(value.request_id && value.expected_filename && value.agent_session_id)
}

async function submitRequest(task, entry, key, current, payload, owner, runtime) {
  const previousURL = runtime.conversationURL(payload.conversation_url || '')
  const destination = previousURL || runtime.homeURL
  // Only a navigation needs its own paced slot here; the upload below is
  // paced anyway. Pacing a page that is already in place spent one 30-second
  // slot per task doing nothing while every other Worker queued behind it.
  if (!runtime.needsNavigation || runtime.needsNavigation(entry, destination)) await runtime.pace()
  const delay = runtime.rateLimitDelay()
  if (delay > 0) return { wait: { status: 'waiting', delayMs: delay, observation: true, error: 'ChatGPT rate-limit cooldown is active' } }
  const target = await runtime.targetComposer(key, destination, Boolean(previousURL), entry)
  target.reasoningEffort = runtime.normalizeEffort(current.reasoning_effort)
  const input = await runtime.buildRequest(key, current)
  try {
    if (!(await runtime.fill(key, target.entry, input.bootstrap))) throw new Error('Orchestrator Agent composer could not be populated')
    for (let index = 0; index < input.uploadPaths.length; index += 1) {
      await runtime.paste(target.entry, input.uploadPaths[index], index + 1, input.uploadPaths.length)
    }
    await runtime.wait(runtime.settleDelay(input.bytes, input.uploadPaths.length))
    if (!(await runtime.fill(key, target.entry, input.bootstrap))) throw new Error('Orchestrator Agent composer changed during upload')
    const baseline = await runtime.assistantCount(target.wc)
    await runtime.submit(key, target)
    const conversationURL = await runtime.waitConversation(key, target.entry, target.conversationUrl)
    if (!conversationURL) throw new Error('Orchestrator Agent submission has no stable conversation id')
    await runtime.checkpoint(task.task_id, owner, {
      active_request_id: current.request_id, conversation_url: conversationURL,
      expected_filename: current.expected_filename, assistant_baseline: baseline,
      submitted_at: new Date().toISOString(),
    })
    return { conversationURL, baseline, target }
  } finally {
    await input.cleanup()
  }
}

// A conversation ChatGPT refuses to load (its "could not load" surface, backed
// by a throttled conversation read) reached nothing that can be charged: the
// attempt comes back as a free wait, long enough for the throttle to pass.
export async function executeOrchestratorExecution(task, entry, key, payload, owner, runtime) {
  try {
    return await runOrchestratorExecution(task, entry, key, payload, owner, runtime)
  } catch (error) {
    if (error?.conversationUnavailable !== true) throw error
    return { status: 'waiting', delayMs: Math.max(0, Number(error.delayMs) || 0), observation: true, error: String(error.message || 'ChatGPT could not load this conversation') }
  }
}

async function runOrchestratorExecution(task, entry, key, payload, owner, runtime) {
  if (payload?.protocol !== 'harness.orchestrator-execution/v1' || payload.task_id !== task.chat_id) {
    return { status: 'failed', error: 'invalid orchestrator execution Worker payload' }
  }
  const sessionID = String(task.session_id || '')
  const taskID = String(payload.task_id || '')
  const credentials = { worker_task_id: task.task_id, owner }
  const current = await workerRequest(runtime.baseURL, sessionID, taskID, 'worker-start', credentials)
  // Only a READY or DOING task can use this attempt. Any other status means
  // the task left execution while the attempt was queued, so it settles.
  if (current.task?.status !== 'READY' && current.task?.status !== 'DOING') return { status: 'done' }
  if (!activeRequest(current)) return { status: 'waiting', delayMs: 30_000, observation: true, error: `Agent state ${String(current.agent_state || 'unknown')}` }
  if (!current.prompt) return { status: 'waiting', delayMs: 30_000, observation: true, error: 'Agent request is awaiting another boundary' }

  let conversationURL = runtime.conversationURL(payload.conversation_url || '')
  let baseline = Number(payload.assistant_baseline || 0)
  let repairCount = Math.max(0, Number(payload.bundle_repair_count) || 0)
  let deliveryCount = Math.max(0, Number(payload.delivery_continuation_count) || 0)
  const now = () => (typeof runtime.now === 'function' ? runtime.now() : Date.now())
  let target = { entry, wc: entry.view.webContents, conversationUrl: conversationURL }
  const resume = payload.active_request_id === current.request_id && payload.expected_filename === current.expected_filename && conversationURL
  if (resume) {
    if (!runtime.sameConversation(target.wc.getURL(), conversationURL)) await runtime.loadURL(key, entry, conversationURL)
    await runtime.waitSurfaceReady(key, entry)
    runtime.phase?.('processing')
  } else {
    const submitted = await submitRequest(task, entry, key, current, payload, owner, runtime)
    if (submitted.wait) return submitted.wait
    ;({ conversationURL, baseline, target } = submitted)
  }

  let resolveDownload
  let rejectDownload
  let download = new Promise((resolve, reject) => { resolveDownload = resolve; rejectDownload = reject })
  download.catch(() => undefined)
  const expected = {
    taskId: task.task_id, filename: current.expected_filename, assistantBaseline: baseline,
    armedAt: Date.now(), resolve: resolveDownload, reject: rejectDownload,
  }
  runtime.expectedDownloads.set(current.expected_filename, expected)
  let thinkingAt = 0
  let deadline = now() + RESPONSE_TIMEOUT_MS
  // A new prompt in the same conversation: the response ZIP must come from a
  // turn after it, and the response window starts again.
  const rearm = (assistantBaseline) => {
    download = new Promise((resolve, reject) => { resolveDownload = resolve; rejectDownload = reject })
    download.catch(() => undefined)
    expected.resolve = resolveDownload
    expected.reject = rejectDownload
    expected.assistantBaseline = assistantBaseline
    expected.freshOnly = true
    expected.downloadStarted = false
    expected.lastClickAt = 0
    thinkingAt = 0
    deadline = now() + RESPONSE_TIMEOUT_MS
  }
  try {
   for (;;) {
    while (now() < deadline) {
      const outcome = await Promise.race([
        download.then((value) => ({ done: true, value }), (error) => ({ done: true, error })),
        runtime.wait(POLL_MS).then(() => ({ done: false })),
      ])
      if (outcome.done) {
        if (outcome.error) throw outcome.error
        runtime.phase?.('validating')
        let result
        try {
          result = await workerRequest(runtime.baseURL, sessionID, taskID, 'worker-bundle', {
            ...credentials, filename: current.expected_filename, content_base64: Buffer.from(outcome.value).toString('base64'),
          }, runtime.postBundle)
        } catch (error) {
          const correction = orchestratorBundleRepairPrompt(error, current.expected_filename)
          if (!correction) throw error
          if (repairCount >= 3) return { status: 'failed', error: `Orchestrator response bundle rejected after ${repairCount} schema repairs: ${String(error.message).slice(0, 300)}` }
          await runtime.pace()
          const delay = runtime.rateLimitDelay()
          if (delay > 0) return { status: 'waiting', delayMs: delay, observation: true, error: 'ChatGPT rate-limit cooldown is active' }
          baseline = await runtime.assistantCount(target.wc)
          if (!(await runtime.fill(key, target.entry, correction))) throw new Error('Orchestrator bundle repair composer could not be populated')
          await runtime.submit(key, target)
          repairCount += 1
          await runtime.checkpoint(task.task_id, owner, { assistant_baseline: baseline, bundle_repair_count: repairCount })
          rearm(baseline)
          continue
        }
        if (result.task?.status !== 'DOING') return { status: 'done' }
        // The Agent accepted the bundle and prepared its next round. That round
        // is bounded by the task's effort level, like any agentic Main Request,
        // so reaching it must not spend the Worker's transport attempts.
        return { status: 'waiting', delayMs: 3_000, observation: true, error: 'Agent continuation is ready' }
      }
      const health = await runtime.health(key, target.entry)
      if (runtime.noteRateLimit(key, health)) return { status: 'waiting', delayMs: runtime.rateLimitDelay(), observation: true, error: 'ChatGPT rate-limit gate is active' }
      if (health?.required === true) return { status: 'attention', providerWide: true, error: runtime.humanActionMessage(String(health.kind || 'verification')) }
      const completion = await runtime.completion(key, target.entry, baseline)
      if (completion?.thinking === true) thinkingAt = now()
      await pollWorkerExpectedDownload(expected,
        (script) => runtime.executeDOM(key, target.entry, 'orchestrator-agent-download', script), runtime.expectedDownloadScript)
    }
    if (thinkingAt && now() - thinkingAt < 60_000) {
      return { status: 'waiting', delayMs: 30_000, observation: true, liveBundlePending: true, error: `ChatGPT is still producing ${current.expected_filename}` }
    }
    // The turn ended without the file. As in an agentic Main Request, a short
    // continuation in the same conversation asks ChatGPT to finish and deliver
    // it, a bounded number of times, before a person is asked to look.
    if (deliveryCount >= MAX_DELIVERY_CONTINUATIONS) {
      return { status: 'attention', error: `ChatGPT did not provide ${current.expected_filename} after ${deliveryCount} delivery continuations` }
    }
    await runtime.pace()
    const delay = runtime.rateLimitDelay()
    if (delay > 0) return { status: 'waiting', delayMs: delay, observation: true, error: 'ChatGPT rate-limit cooldown is active' }
    baseline = await runtime.assistantCount(target.wc)
    if (!(await runtime.fill(key, target.entry, chatGPTDeliveryContinuationPrompt()))) throw new Error('Orchestrator delivery continuation composer could not be populated')
    await runtime.submit(key, target)
    deliveryCount += 1
    await runtime.checkpoint(task.task_id, owner, { assistant_baseline: baseline, delivery_continuation_count: deliveryCount })
    runtime.phase?.('processing')
    rearm(baseline)
   }
  } finally {
    if (runtime.expectedDownloads.get(current.expected_filename) === expected) runtime.expectedDownloads.delete(current.expected_filename)
  }
}
