export function createChatAgentAutoScaleRuntime({
  state, chatAgentQueueDiagnostics, chatAgentRateLimitDelayMs,
  autoScaleWorkerDemand, autoScaleTarget, chatAgentAvailableWorkers,
  setChatAgentWorkerTarget, publishChatAgentRuntimeState,
  CHAT_AGENT_AUTO_SCALE_DRAIN_COOLDOWN_MS, autoScaleDrainTarget,
  chatAgentKeepFlowingFloor, translatorCapacityTarget,
  activeChatTranslatorSlots, chatAgentAvailableSupervisors,
  autoScaleSupervisorTarget, setChatAgentSupervisorTarget,
  autoScaleSupervisorDrainTarget, chatgptViews,
}) {
  async function reconcileChatAgentAutoScale() {
    if (!state.chatAgentScheduler) return
    try {
      const summary = await state.chatAgentScheduler.queueSummary()
      reconcileChatTranslatorCapacity(summary)
      if (state.chatAgentPolicies.auto_scale !== true) return
      const queue = chatAgentQueueDiagnostics(summary)
      state.chatAgentRuntimeDiagnostics = { ...state.chatAgentRuntimeDiagnostics, queue }
      // Both pools are reconciled on the same tick and from the same reading, but
      // never from the same number: they own disjoint task types, so the shared
      // `due` total describes neither of them.
      const supervisorChanged = reconcileChatAgentSupervisorAutoScale(queue)
      // Worker suspension is intentionally narrower than the provider gate: the
      // Supervisor pool remains operational while Workers stop taking new claims.
      if (chatAgentRateLimitDelayMs() > 0 || state.chatAgentRuntimeDiagnostics.provider?.paused === true) {
        if (supervisorChanged) publishChatAgentRuntimeState()
        return
      }
      const dueWorker = autoScaleWorkerDemand(summary, state.chatAgentPolicies)
      const grow = autoScaleTarget({
        enabled: true, due: dueWorker, available: chatAgentAvailableWorkers(), current: state.desiredChatAgentWorkerSlots, maxWorkers: state.chatAgentPolicies.auto_scale_max_workers,
      })
      if (grow > state.desiredChatAgentWorkerSlots) {
        console.log(`[chat-agent] auto-scale grow from=${state.desiredChatAgentWorkerSlots} to=${grow} due=${dueWorker}`)
        state.chatAgentWorkerLastGrowAt = Date.now()
        setChatAgentWorkerTarget(grow)
        publishChatAgentRuntimeState()
        return
      }
      if (Date.now() - state.chatAgentWorkerLastGrowAt < CHAT_AGENT_AUTO_SCALE_DRAIN_COOLDOWN_MS) {
        if (supervisorChanged) publishChatAgentRuntimeState()
        return
      }
      const drain = autoScaleDrainTarget({
        enabled: true, due: dueWorker, configured: state.configuredChatAgentWorkerSlots, current: state.desiredChatAgentWorkerSlots, keepFlowingFloor: chatAgentKeepFlowingFloor(),
      })
      if (drain < state.desiredChatAgentWorkerSlots) {
        console.log(`[chat-agent] auto-scale drain from=${state.desiredChatAgentWorkerSlots} to=${drain}`)
        setChatAgentWorkerTarget(drain)
        publishChatAgentRuntimeState()
        return
      }
      if (supervisorChanged) publishChatAgentRuntimeState()
    } catch (error) { console.warn(`[chat-agent] auto-scale poll failed: ${error instanceof Error ? error.message : String(error)}`) }
  }

  function reconcileChatTranslatorCapacity(summary) {
    if (!state.chatTranslatorScheduler) return
    state.dueChatTranslations = Math.max(0, Number(summary?.due_translator) || 0)
    // Orchestrator execution Workers are never counted as capacity here: an
    // ephemeral task gets its own browser instead of waiting for one of them.
    const target = translatorCapacityTarget({
      due: state.dueChatTranslations,
      active: activeChatTranslatorSlots.size,
    })
    state.chatTranslatorScheduler.setWorkerCount(target)
  }

  // Auto scale for the Supervisor pool.
  //
  // Kept separate from the Worker reconciliation because the two pools share only
  // the queue they read: a Supervisor serves one conversation for the life of its
  // request, so its demand is lanes waiting for a slot, and its ceiling is its own
  // policy. Without this the pool could only ever be the number of slots it was
  // constructed with, whatever the operator or the backlog asked for.
  function reconcileChatAgentSupervisorAutoScale(queue) {
    const available = chatAgentAvailableSupervisors()
    const grow = autoScaleSupervisorTarget({
      enabled: true, dueLanes: queue.due_supervisor_lanes, available,
      current: state.desiredChatAgentSupervisorSlots, maxSupervisors: state.chatAgentPolicies.auto_scale_max_supervisors,
    })
    if (grow > state.desiredChatAgentSupervisorSlots) {
      console.log(`[chat-agent] supervisor auto-scale grow from=${state.desiredChatAgentSupervisorSlots} to=${grow} lanes=${queue.due_supervisor_lanes}`)
      state.chatAgentSupervisorLastGrowAt = Date.now()
      setChatAgentSupervisorTarget(grow)
      return true
    }
    if (Date.now() - state.chatAgentSupervisorLastGrowAt < CHAT_AGENT_AUTO_SCALE_DRAIN_COOLDOWN_MS) return false
    const drain = autoScaleSupervisorDrainTarget({
      enabled: true, dueLanes: queue.due_supervisor_lanes, configured: state.configuredChatAgentSupervisorSlots,
      current: state.desiredChatAgentSupervisorSlots, boundSupervisors: chatgptViews.size,
    })
    if (drain < state.desiredChatAgentSupervisorSlots) {
      console.log(`[chat-agent] supervisor auto-scale drain from=${state.desiredChatAgentSupervisorSlots} to=${drain}`)
      setChatAgentSupervisorTarget(drain)
      return true
    }
    return false
  }

  return { reconcileChatAgentAutoScale, reconcileChatTranslatorCapacity, reconcileChatAgentSupervisorAutoScale }
}
