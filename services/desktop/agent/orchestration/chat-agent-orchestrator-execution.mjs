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

// A backend that cannot answer (restarting, or its own store failing) says
// nothing about the task. Nothing reached ChatGPT, so such an attempt must come
// back as a free wait instead of spending the task's bounded budget.
function backendUnavailable(message, cause = undefined) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.backendUnavailable = true
  return error
}

async function workerRequest(baseURL, sessionID, taskID, suffix, body) {
  const path = `/api/sessions/${encodeURIComponent(sessionID)}/orchestrator/tasks/${encodeURIComponent(taskID)}/${suffix}`
  let response
  try {
    response = await fetch(new URL(path, baseURL), {
      method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
  } catch (error) {
    throw backendUnavailable(`orchestrator Worker ${suffix}: backend unreachable (${String(error?.message || error)})`, error)
  }
  if (!response.ok) {
    let detail = ''
    try { detail = String((await response.json())?.error?.message || '') } catch {}
    const message = `orchestrator Worker ${suffix} HTTP ${response.status}${detail ? `: ${detail}` : ''}`
    if (response.status === 502 || response.status === 503 || response.status === 504) throw backendUnavailable(message)
    throw new Error(message)
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

function affinityFailure(message, cause = undefined) {
  const error = new Error(String(message || 'Orchestrator task conversation affinity failed closed'), cause ? { cause } : undefined)
  error.orchestratorConversationMismatch = true
  return error
}

function sameConversation(runtime, left, right) {
  const a = runtime.conversationURL(left)
  const b = runtime.conversationURL(right)
  return Boolean(a && b && a === b)
}

export function createOrchestratorConversationGuard(runtime) {
  const ensureConversation = async (key, entry, conversationURL) => {
    const expected = runtime.conversationURL(conversationURL)
    if (!expected) throw affinityFailure('A bound Orchestrator task has no concrete ChatGPT conversation URL.')
    const before = runtime.currentURL(entry)
    if (!sameConversation(runtime, before, expected)) {
      await runtime.pace()
      await runtime.load(key, entry, expected)
    }
    await runtime.waitReady(key, entry)
    const raw = runtime.currentURL(entry)
    const observed = runtime.conversationURL(raw)
    if (!observed || !sameConversation(runtime, observed, expected)) {
      throw affinityFailure(`The Orchestrator task is bound to ${expected}, but the Worker observed ${observed || raw || 'no conversation'}; the request was not resent.`)
    }
    return observed
  }

  const submissionHooks = (conversationURL, bindSubmittedConversation) => ({
    onTargetConversation(observedURL) {
      if (!conversationURL) return
      const observed = runtime.conversationURL(observedURL)
      if (!observed || !sameConversation(runtime, observed, conversationURL)) {
        throw affinityFailure(`The Orchestrator task is bound to ${conversationURL}, but the send surface opened ${observed || 'another page'}; the request was not submitted.`)
      }
    },
    async onSubmittedConversation(observedURL) {
      const observed = runtime.conversationURL(observedURL)
      if (!observed) throw affinityFailure('The Orchestrator submit did not produce a concrete ChatGPT conversation.')
      if (conversationURL && !sameConversation(runtime, observed, conversationURL)) {
        throw affinityFailure(`After submit ChatGPT moved the Orchestrator task from ${conversationURL} to ${observed}; execution ended without resending.`)
      }
      if (typeof bindSubmittedConversation !== 'function') throw affinityFailure('The Orchestrator Worker did not receive its durable conversation binder.')
      const bound = runtime.conversationURL(await bindSubmittedConversation(observed))
      if (!bound || !sameConversation(runtime, bound, observed)) {
        throw affinityFailure(`The backend did not confirm the same Orchestrator conversation observed after submit (${observed}).`)
      }
      return bound
    },
  })

  return { ensureConversation, submissionHooks }
}

export async function executeOrchestratorExecution(task, entry, key, payload, owner, runtime) {
  try {
    return await driveOrchestratorRound(task, entry, key, payload, owner, runtime)
  } catch (error) {
    // A conversation ChatGPT refuses to load reached nothing that can be
    // charged: the attempt comes back as a free wait.
    if (error?.conversationUnavailable === true) {
      return observe(String(error.message || 'ChatGPT could not load this conversation'), Math.max(0, Number(error.delayMs) || 0))
    }
    if (error?.backendUnavailable === true) return observe(String(error.message))
    // Affinity divergence is not a transient transport failure. Retrying could
    // submit the same Main Request into a second conversation, so fail the
    // execution task immediately and leave the concrete diagnostic visible.
    if (error?.orchestratorConversationMismatch === true) {
      return { status: 'failed', error: String(error.message || 'Orchestrator task conversation affinity diverged') }
    }
    throw error
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
  if (!activeRequest(current)) {
    const kind = String(current.agent_failure_kind || '')
    return observe(`Agent state ${String(current.agent_state || 'unknown')}${kind ? ` (${kind})` : ''}`)
  }
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

  // worker-start is the authoritative task affinity. A checkpoint from an old
  // request may still carry another URL after retry/reclaim; it is deliberately
  // ignored once the backend has a definitive task conversation.
  const definitiveURL = runtime.conversationURL(current.conversation_url || '')
  const checkpointURL = runtime.conversationURL(payload.conversation_url || '')
  const conversationURL = definitiveURL || checkpointURL

  // A bound task never prepares content on home or on whichever conversation
  // happens to be resident in the Worker. Load the definitive URL and verify
  // that ChatGPT actually rendered that same conversation before adoption or
  // submission can inspect/fill the composer.
  if (conversationURL) await runtime.ensureConversation(key, entry, conversationURL)

  // A request an earlier attempt already submitted is handed to the agentic
  // supervision, never sent twice.
  if (!resend && payload.active_request_id === current.request_id && conversationURL &&
      await runtime.adopt(key, entry, current, conversationURL, Number(payload.assistant_baseline || 0))) {
    return observe('submitted request adopted by agentic supervision')
  }
  if (!conversationURL && runtime.needsNavigation(entry, runtime.homeURL)) await runtime.pace()
  const delay = runtime.rateLimitDelay()
  if (delay > 0) return observe('ChatGPT rate-limit cooldown is active', delay)

  // Binding runs from inside PREPARE_PROMPT immediately after ChatGPT exposes
  // the concrete post-submit URL and before any follow-up/supervision task is
  // enqueued. This closes the only window where a restart could lose the
  // conversation and later resend the same Main Request somewhere else.
  const bindSubmittedConversation = async (observedURL) => {
    const observed = runtime.conversationURL(observedURL || '')
    if (!observed) throw affinityFailure('ChatGPT submitted the Orchestrator request without a concrete conversation URL; no retry was attempted.')
    if (definitiveURL && !sameConversation(runtime, observed, definitiveURL)) {
      throw affinityFailure(`ChatGPT changed the Orchestrator task conversation from ${definitiveURL} to ${observed}; execution stopped before any resend.`)
    }
    let stored
    try {
      stored = await workerRequest(runtime.baseURL, sessionID, taskID, 'worker-conversation', { ...credentials, conversation_url: observed })
    } catch (error) {
      throw affinityFailure(`The backend rejected Orchestrator conversation ${observed}; execution stopped before any resend. ${String(error?.message || error)}`, error)
    }
    const storedURL = runtime.conversationURL(stored?.conversation_url || '')
    if (!storedURL || !sameConversation(runtime, storedURL, observed) || (definitiveURL && !sameConversation(runtime, storedURL, definitiveURL))) {
      throw affinityFailure(`The backend reported a different Orchestrator conversation after submit; expected ${definitiveURL || observed} and received ${storedURL || 'none'}.`)
    }
    return storedURL
  }

  const sent = await runtime.sendMainRequest(key, entry, current, conversationURL, bindSubmittedConversation)
  const boundURL = runtime.conversationURL(sent?.conversationUrl || '')
  if (!boundURL) throw affinityFailure('Orchestrator Main Request finished submission without a bound conversation URL.')
  if (conversationURL && !sameConversation(runtime, boundURL, conversationURL)) {
    throw affinityFailure(`Orchestrator submission returned ${boundURL} instead of the definitive task conversation ${conversationURL}.`)
  }
  await runtime.checkpoint(task.task_id, owner, {
    active_request_id: current.request_id, conversation_url: boundURL,
    expected_filename: current.expected_filename, submitted_at: new Date().toISOString(),
    ...(resend ? { resent_request_id: current.request_id, resend_count: resends + 1 } : {}),
  })
  return observe(resend ? `request resent after stalled supervision (${resends + 1}/${MAX_REQUEST_RESENDS})` : 'Main Request round submitted; agentic supervision owns the response')
}
