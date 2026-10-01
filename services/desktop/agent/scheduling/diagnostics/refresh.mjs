export function createChatAgentRuntimeRefresh({
  state, chatGPTWorkerEntries, chatAgentWorkerStates,
  HARD_MAX_WORKER_SLOTS, chatAgentQueueDiagnostics, runtimeState,
}) {
  function reconcileChatAgentWorkerTasks(tasks = []) {
    const prefix = `${state.scheduler?.instanceID || ''}:worker-`
    if (!state.scheduler?.instanceID) return
    const activeByWorker = new Map()
    for (const task of tasks) {
      const status = String(task?.status || '').toUpperCase()
      const owner = String(task?.lease_owner || '')
      if (!['LEASED', 'RUNNING'].includes(status) || !owner.startsWith(prefix)) continue
      const worker = Number(owner.slice(prefix.length))
      if (!Number.isInteger(worker) || worker < 1 || worker > HARD_MAX_WORKER_SLOTS) continue
      const current = activeByWorker.get(worker)
      if (!current || String(task?.updated_at || '') > String(current?.updated_at || '')) activeByWorker.set(worker, task)
    }
    for (let worker = 1; worker <= chatGPTWorkerEntries.length; worker += 1) {
      const prior = chatAgentWorkerStates.get(worker) || { active: worker <= state.desiredWorkerSlots, task: undefined, lastTask: undefined, lastClaimAt: '', error: '' }
      const task = activeByWorker.get(worker)
      if (task) {
        chatAgentWorkerStates.set(worker, { ...prior, active: true, task, lastTask: task, lastClaimAt: String(task.updated_at || prior.lastClaimAt || ''), error: '' })
      } else if (prior.task) {
        chatAgentWorkerStates.set(worker, { ...prior, task: undefined })
      }
    }
  }

  async function refreshChatAgentRuntimeState() {
    const now = new Date().toISOString()
    const scheduler = state.scheduler
    if (!scheduler) {
      state.diagnostics = {
        ...state.diagnostics,
        scheduler: { running: false, backend_reachable: false, last_refresh_at: now, last_error: 'Scheduler ainda não iniciado' },
      }
      return runtimeState()
    }
    try {
      const [summary, leased, running, provider] = await Promise.all([
        scheduler.queueSummary(),
        scheduler.list({ status: 'LEASED', limit: 50 }),
        scheduler.list({ status: 'RUNNING', limit: 50 }),
        scheduler.providerState(),
      ])
      reconcileChatAgentWorkerTasks([...(leased?.tasks || []), ...(running?.tasks || [])])
      state.diagnostics = {
        scheduler: { running: Boolean(scheduler.running), backend_reachable: true, last_refresh_at: now, last_error: '' },
        queue: chatAgentQueueDiagnostics(summary),
        provider: {
          provider: String(provider?.provider || 'chatgpt'), paused: provider?.paused === true,
          paused_until: String(provider?.paused_until || ''), reason: String(provider?.reason || ''),
          rate_limit_level: Math.max(0, Number(provider?.rate_limit_level || 0)), last_rate_limit_at: String(provider?.last_rate_limit_at || ''),
          last_rate_limit_source: String(provider?.last_rate_limit_source || ''), last_valid_bundle_at: String(provider?.last_valid_bundle_at || ''),
          average_processing_ms: Math.max(0, Number(provider?.average_processing_ms || 0)), valid_sample_count: Math.max(0, Number(provider?.valid_sample_count || 0)),
          initial_wait_ms: Math.max(60_000, Number(provider?.initial_wait_ms || 60_000)), updated_at: String(provider?.updated_at || ''),
        },
      }
      // Follow the durable provider deadline in both directions. A stale
      // refresh cannot clear a newer local gate still being persisted.
      const pausedUntil = Date.parse(String(provider?.paused_until || ''))
      if (provider?.paused === true && Number.isFinite(pausedUntil)) {
        state.rateLimitUntil = Math.max(state.rateLimitUntil, pausedUntil)
        if (provider?.last_rate_limit_source || String(provider?.reason || '').includes('rate-limit')) state.resumeProbeRequired = true
      } else if (provider?.paused === false) {
        const observedAt = Date.parse(String(provider?.updated_at || '')) || 0
        if (!state.rateLimitAppliedAt || observedAt >= state.rateLimitAppliedAt) {
          state.rateLimitUntil = 0
          state.rateLimitKind = ''
          state.rateLimitAppliedAt = 0
        }
      }
    } catch (error) {
      state.diagnostics = {
        ...state.diagnostics,
        scheduler: {
          running: Boolean(scheduler.running), backend_reachable: false, last_refresh_at: now,
          last_error: String(error?.message || error || 'Backend do scheduler indisponível'),
        },
      }
    }
    return runtimeState()
  }

  return { reconcileChatAgentWorkerTasks, refreshChatAgentRuntimeState }
}
