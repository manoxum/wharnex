// An Orchestrator task is one agentic Main Request (adr/ADR-0081). This
// attempt is only its round driver. It starts the task, and whenever the Agent
// leaves a request pending that no agentic supervision owns yet, it sends that
// request with the same pipeline a chat uses (PREPARE_PROMPT). Supervision,
// keep-continue recovery, download, delivery and bundle repair are the agentic
// ones, served by the Worker pinned to the task (adr/ADR-0082). Every round,
// repair and retry continues in the task's one conversation.
const OBSERVE_MS = 30_000
// How many times the driver may resend one request after its supervision gave up.
const MAX_REQUEST_RESENDS = 2

async function workerRequest(baseURL, sessionID, taskID, suffix, body) {
  const path = `/api/sessions/${encodeURIComponent(sessionID)}/orchestrator/tasks/${encodeURIComponent(taskID)}/${suffix}`
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

// Observing never spends the attempt budget: the Agent's own effort level
// bounds its rounds, exactly as in an agentic Main Request.
function observe(error, delayMs = OBSERVE_MS) {
  return { status: 'waiting', delayMs, observation: true, error }
}

export async function executeOrchestratorExecution(task, entry, key, payload, owner, runtime) {
  try {
    return await driveOrchestratorRound(task, entry, key, payload, owner, runtime)
  } catch (error) {
    // A conversation ChatGPT refuses to load reached nothing that can be
    // charged: the attempt comes back as a free wait.
    if (error?.conversationUnavailable !== true) throw error
    return observe(String(error.message || 'ChatGPT could not load this conversation'), Math.max(0, Number(error.delayMs) || 0))
  }
}

async function driveOrchestratorRound(task, entry, key, payload, owner, runtime) {
  if (payload?.protocol !== 'harness.orchestrator-execution/v1' || payload.task_id !== task.chat_id) {
    return { status: 'failed', error: 'invalid orchestrator execution Worker payload' }
  }
  const sessionID = String(task.session_id || '')
  const taskID = String(payload.task_id || '')
  const credentials = { worker_task_id: task.task_id, owner }
  const current = await workerRequest(runtime.baseURL, sessionID, taskID, 'worker-start', credentials)
  // Only a READY or DOING task can use this attempt. Any other status means
  // the task left execution, so the round driver settles.
  if (current.task?.status !== 'READY' && current.task?.status !== 'DOING') return { status: 'done' }
  if (!activeRequest(current)) return observe(`Agent state ${String(current.agent_state || 'unknown')}`)
  if (!current.prompt) return observe('Agent request is awaiting another boundary')

  const supervision = await runtime.supervision(key, current.request_id)
  if (supervision.state === 'active') return observe('agentic supervision owns this request')
  if (supervision.state === 'delivered') return observe('the Agent is ingesting the delivered bundle')
  // Supervision gave up (no bundle after its bounded recovery). In a chat a
  // person now presses "Retomar pedido"; a task has nobody, so the driver
  // does it: the same request again in the same conversation, a bounded
  // number of times, before the run ends.
  const resends = payload.resent_request_id === current.request_id ? Number(payload.resend_count || 0) : 0
  if (supervision.state === 'ended' && resends >= MAX_REQUEST_RESENDS) {
    return { status: 'failed', error: supervision.error || `ChatGPT did not deliver ${current.expected_filename}` }
  }
  const resend = supervision.state === 'ended'

  const conversationURL = runtime.conversationURL(current.conversation_url || payload.conversation_url || '')
  // A request an earlier attempt already submitted is handed to the agentic
  // supervision, never sent twice.
  if (!resend && payload.active_request_id === current.request_id && conversationURL &&
      await runtime.adopt(key, entry, current, conversationURL, Number(payload.assistant_baseline || 0))) {
    return observe('submitted request adopted by agentic supervision')
  }
  if (runtime.needsNavigation(entry, conversationURL || runtime.homeURL)) await runtime.pace()
  const delay = runtime.rateLimitDelay()
  if (delay > 0) return observe('ChatGPT rate-limit cooldown is active', delay)
  const sent = await runtime.sendMainRequest(key, entry, current, conversationURL)
  const stored = await workerRequest(runtime.baseURL, sessionID, taskID, 'worker-conversation', { ...credentials, conversation_url: sent.conversationUrl })
  await runtime.checkpoint(task.task_id, owner, {
    active_request_id: current.request_id, conversation_url: stored.conversation_url || sent.conversationUrl,
    expected_filename: current.expected_filename, submitted_at: new Date().toISOString(),
    ...(resend ? { resent_request_id: current.request_id, resend_count: resends + 1 } : {}),
  })
  return observe(resend ? `request resent after stalled supervision (${resends + 1}/${MAX_REQUEST_RESENDS})` : 'Main Request round submitted; agentic supervision owns the response')
}
