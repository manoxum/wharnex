export function createChatAgentCapacityAvailability({
  state, chatGPTWorkerEntries, workerEntryForIndex,
  chatAgentKeepFlowingActive, orchestrationTaskPins,
  chatAgentWorkerStates, normalizeSupervisorSlotCount,
  normalizeWorkerSlotCount, publishChatAgentRuntimeState,
  chatgptViews, chatSupervisorLeaseKeys, supervisorBindingHeld,
  reconcileChatGPTWorkerPool,
}) {
  function chatAgentKeepFlowingFloor() {
    let floor = 0
    for (let worker = 1; worker <= chatGPTWorkerEntries.length; worker += 1) {
      const entry = workerEntryForIndex(worker)
      if (chatAgentKeepFlowingActive(worker) || (entry && orchestrationTaskPins.lane(entry.slotId))) floor = worker
    }
    return floor
  }

  function chatAgentAvailableWorkers() {
    let available = 0
    for (let worker = 1; worker <= state.desiredChatAgentWorkerSlots; worker += 1) {
      const entry = workerEntryForIndex(worker)
      const runtime = chatAgentWorkerStates.get(worker)
      if (!entry || runtime?.active === false || runtime?.task || chatAgentKeepFlowingActive(worker)) continue
      if (entry.interactionWindowId || entry.accountOperationActive || entry.transportPreparationCount > 0 || entry.loading) continue
      // A Worker pinned to an Orchestrator task serves only that task.
      if (orchestrationTaskPins.lane(entry.slotId)) continue
      available += 1
    }
    return available
  }

  // Resize the Supervisor pool.
  //
  // The count has to reach the Supervisor scheduler, which owns one claim loop per
  // slot. Sending it to the Worker scheduler instead — as this did — left the
  // Supervisor pool frozen at whatever count it was constructed with, so neither
  // the operator's stepper nor Auto scale could ever add a Supervisor, while the
  // Worker pool was silently resized to the Supervisor number.
  function setChatAgentSupervisorTarget(target) {
    const normalized = normalizeSupervisorSlotCount(target)
    if (normalized === state.desiredChatAgentSupervisorSlots) return normalized
    state.desiredChatAgentSupervisorSlots = normalized
    state.chatSupervisorScheduler?.setSupervisorCount(normalized)
    publishChatAgentRuntimeState()
    return normalized
  }

  // Supervisor slots that could take a waiting chat right now.
  //
  // A slot counts as available when it holds no renderer yet (the pool has not
  // grown into it), or when the renderer it holds is neither mid-request nor
  // running a lease. A held Supervisor is not available at any price: taking its
  // chat is the cross-chat reload this topology exists to remove.
  function chatAgentAvailableSupervisors() {
    const bound = chatgptViews.size
    let available = Math.max(0, state.desiredChatAgentSupervisorSlots - bound)
    const leased = chatSupervisorLeaseKeys()
    for (const [key, entry] of chatgptViews) {
      if (leased.has(key) || supervisorBindingHeld(key, entry)) continue
      available += 1
    }
    return available
  }

  function setChatAgentWorkerTarget(target, windowState) {
    const normalized = normalizeWorkerSlotCount(target)
    if (normalized === state.desiredChatAgentWorkerSlots) return normalized
    state.desiredChatAgentWorkerSlots = normalized
    state.chatAgentScheduler?.setWorkerCount(normalized)
    reconcileChatGPTWorkerPool(windowState)
    return normalized
  }

  return { chatAgentKeepFlowingFloor, chatAgentAvailableWorkers, setChatAgentSupervisorTarget, chatAgentAvailableSupervisors, setChatAgentWorkerTarget }
}
