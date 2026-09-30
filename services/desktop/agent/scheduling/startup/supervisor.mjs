export function createSupervisorScheduler({
  ChatAgentSchedulerClient, BACKEND_URL, desiredChatAgentSupervisorSlots,
  HARD_MAX_SUPERVISOR_SLOTS, withTrace, traceForTask, executeChatSupervisorTask,
  chatSupervisorSlotID, chatSupervisorHostWindow, chatSupervisorStates,
  sanitizeOptionalChatCacheKey, chatgptViews, projectWindowRegistry,
  supervisorBindingHeld, chatSupervisorLanesHeldByOthers,
  publishChatAgentRuntimeState,
}) {
  return new ChatAgentSchedulerClient({
    baseURL: BACKEND_URL, workerCount: desiredChatAgentSupervisorSlots, maxWorkers: HARD_MAX_SUPERVISOR_SLOTS,
    execute: (task, context) => withTrace(traceForTask(task), () => executeChatSupervisorTask(task, context)), role: 'supervisor', agentID: chatSupervisorSlotID,
    // Supervision spends almost all of its life handing the slot back between
    // observations, so a task cooldown here would only delay reading a page that
    // is already loaded. The provider pacing gate still covers every real action.
    taskCooldownMs: 0,
    claimOptions: (index) => {
      if (!chatSupervisorHostWindow()) return { skip: true }
      const runtime = chatSupervisorStates.get(index) || {}
      const lane = String(runtime.lane || '')
      const key = sanitizeOptionalChatCacheKey(runtime.key)
      const entry = key ? chatgptViews.get(key) : undefined
      const scope = { project_scoped: true, open_projects: projectWindowRegistry.openProjects() }
      // A Supervisor mid-request serves only its own chat. Letting it claim
      // another conversation is precisely the cross-chat navigation this pool
      // exists to remove, and it would also abandon a request in flight.
      if (lane && entry && supervisorBindingHeld(key, entry)) {
        return { preferred_lane: lane, fallback_mode: 'resident_only', ...scope }
      }
      // Free: prefer the chat it already has loaded, but accept any chat-bound
      // work except the lanes other Supervisors are still holding.
      const taken = chatSupervisorLanesHeldByOthers(index)
      return {
        preferred_lane: lane, fallback_mode: 'any',
        excluded_lanes: [...taken].slice(0, 32), ...scope,
      }
    },
    // A claim that reaches the backend and finds nothing proves this slot's
    // loop is healthy again. Without this, a Supervisor whose last claim
    // attempt failed (worker-error) stayed painted "Com erro" indefinitely —
    // the whole pool read as broken even once the underlying condition (a
    // slow backend restart, a transient network hiccup) had long resolved,
    // because nothing ever cleared a sticky error on an otherwise-idle slot.
    onIdle: (index) => {
      const prior = chatSupervisorStates.get(index)
      if (!prior?.error) return
      chatSupervisorStates.set(index, { ...prior, error: '' })
      publishChatAgentRuntimeState()
    },
    onState: (state) => {
      const slot = Number(state?.worker || 0)
      if (slot) {
        const prior = chatSupervisorStates.get(slot) || { active: true, task: undefined, lastTask: undefined, lastClaimAt: '', error: '', lane: '', key: '' }
        if (state.kind === 'worker-started') chatSupervisorStates.set(slot, { ...prior, active: true })
        else if (state.kind === 'worker-stopped') chatSupervisorStates.set(slot, { ...prior, active: false, task: undefined })
        else if (state.kind === 'running') chatSupervisorStates.set(slot, { ...prior, active: true, task: state.task, lastTask: state.task, lastClaimAt: new Date().toISOString(), error: '' })
        else if (state.kind === 'settled') chatSupervisorStates.set(slot, { ...prior, task: undefined, lastTask: state.task || prior.lastTask, lastResult: state.result, error: '' })
        else if (state.kind === 'task-error') chatSupervisorStates.set(slot, { ...prior, task: undefined, lastTask: state.task || prior.lastTask, error: String(state?.error?.message || state?.error || '') })
        else if (state.kind === 'worker-error') chatSupervisorStates.set(slot, { ...prior, task: undefined, error: String(state?.error?.message || state?.error || '') })
      }
      publishChatAgentRuntimeState()
    },
  })
}
