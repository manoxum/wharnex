export function chatAgentBackoff(attempt, { baseMs = 2_000, maxMs = 60_000, jitter = Math.random } = {}) {
  const exp = Math.min(maxMs, baseMs * (2 ** Math.max(0, Number(attempt || 1) - 1)))
  const spread = Math.max(1, Math.floor(exp * 0.2))
  return exp - spread + Math.floor(jitter() * spread * 2)
}

export function chatAgentErrorDisposition(error) {
  const detail = error instanceof Error ? error.message : String(error || '')
  if (/artifact_storage_full|xminiostoragefull|minimum free drive threshold|no space left|armazenamento.+(?:sem espaço|cheio)/i.test(detail)) {
    return { action: 'attention', error: detail }
  }
  return { action: 'retry', error: detail }
}

const notBefore = (delayMs) => new Date(Date.now() + delayMs).toISOString()

function waitingTransition(task, owner, result) {
  // An observation only watched healthy remote progress. The backend returns
  // the attempt the claim charged, so the task stays claimable and the
  // exhaustion guard below must not apply: a long but perfectly healthy
  // response would otherwise have its own supervisor killed.
  const observation = result.observation === true
  // Claim increments attempt before execution. A task that is put back in
  // WAITING on its final attempt can never be claimed again because the
  // backend intentionally excludes attempt >= max_attempts. Fail it
  // terminally here instead of creating an unreachable queue record.
  if (!observation && Number(task.attempt || 0) >= Number(task.max_attempts || 0)) {
    return ['fail', { owner, error: String(result.error || 'chat-agent task exhausted maximum attempts while waiting') }]
  }
  const delay = Number(result.delayMs) || chatAgentBackoff(task.attempt)
  return ['wait', { owner, not_before: result.notBefore || notBefore(delay), error: String(result.error || ''), observation }]
}

// Records the durable outcome of one executed task.
export async function settleTaskResult(api, task, owner, result, { running }) {
  if (!running && result?.status !== 'done') {
    return api.transition(task.task_id, 'wait', { owner, not_before: notBefore(1_000), error: 'desktop shutting down' })
  }
  if (result?.status === 'waiting') return api.transition(task.task_id, ...waitingTransition(task, owner, result))
  if (result?.status === 'attention') {
    if (result.providerWide) {
      await api.setProviderPause(true, { pausedUntil: result.pausedUntil || null, reason: String(result.error || 'ChatGPT requires human attention') })
    }
    return api.transition(task.task_id, 'attention', { owner, error: String(result.error || '') })
  }
  if (result?.status === 'failed') return api.transition(task.task_id, 'fail', { owner, error: String(result.error || '') })
  return api.transition(task.task_id, 'complete', { owner, ...(result?.payload !== undefined ? { payload: result.payload } : {}) })
}

// Records the durable outcome of a task whose execution threw, and returns the
// status the worker loop reports for it.
export async function settleTaskError(api, task, owner, error) {
  // A typed deferral raised before anything reached ChatGPT (the account
  // upload limit) is a free observation: the task waits out the window
  // without spending its attempt budget, whichever pool ran it.
  if (error?.freeDeferral === true) {
    const result = { status: 'waiting', delayMs: Number(error.delayMs) || 60_000, observation: true, error: String(error.message || '') }
    await api.transition(task.task_id, ...waitingTransition(task, owner, result)).catch(() => undefined)
    return result
  }
  const disposition = chatAgentErrorDisposition(error)
  if (disposition.action === 'attention') {
    await api.transition(task.task_id, 'attention', { owner, error: disposition.error }).catch(() => undefined)
    return { status: 'attention', error: disposition.error }
  }
  const retryable = task.attempt < task.max_attempts
  const body = retryable
    ? { owner, not_before: notBefore(chatAgentBackoff(task.attempt)), error: disposition.error }
    : { owner, error: disposition.error }
  await api.transition(task.task_id, retryable ? 'wait' : 'fail', body).catch(() => undefined)
  return { status: retryable ? 'waiting' : 'failed' }
}
