export function createWorkerScheduler({
  ChatAgentSchedulerClient, BACKEND_URL, desiredChatAgentWorkerSlots,
  HARD_MAX_WORKER_SLOTS, withTrace, traceForTask, chatAgentWorkerActivity,
  executeChatAgentTask, noteOrchestrationTaskPin,
  parkChatGPTWorkerAfterLoadFailure, workerEntryForIndex,
  releaseChatGPTConversationReadProbe, workerSuspensionState,
  getChatAgentPolicies, workerSuspendsAllTaskTypes, chatAgentRateLimitResumeBlocked,
  chatSupervisorBoundLanes, chatAgentResidency, chatAgentKeepFlowingActive,
  chatAgentSupervisingLiveResponse, projectWindowRegistry,
  orchestrationTaskPins, chatGPTWorkerEntries, publishChatAgentRuntimeState,
  chatAgentWorkerStates, closeWorkerMonitorAfterState,
  reconcileChatGPTWorkerPool, workerHost, refreshChatAgentRuntimeState,
}) {
  return new ChatAgentSchedulerClient({
    baseURL: BACKEND_URL, workerCount: desiredChatAgentWorkerSlots, maxWorkers: HARD_MAX_WORKER_SLOTS, execute: (task, context) => withTrace(traceForTask(task), () => chatAgentWorkerActivity.run(`worker-${Number(context?.worker) || 0}`, task.task_id, () => executeChatAgentTask(task, context)))
      .then((result) => { noteOrchestrationTaskPin(context?.worker, task, result); return result },
        (error) => { noteOrchestrationTaskPin(context?.worker, task, { status: 'error' }); throw error })
      .finally(() => {
        parkChatGPTWorkerAfterLoadFailure(workerEntryForIndex(context?.worker))
        releaseChatGPTConversationReadProbe(task.task_id)
      }),
    // The Worker pool takes only small account-lifecycle and utility work. The
    // durable claim enforces that partition, so no attempt is charged to reject
    // a chat-bound task this pool must never navigate to.
    role: 'worker',
    claimOptions: (worker) => {
      // Operator suspension is Worker-only: current tasks may settle, but this
      // pool must not claim another task until manual or timed release.
      const manualSuspension = workerSuspensionState(getChatAgentPolicies())
      if (workerSuspendsAllTaskTypes(getChatAgentPolicies())) return { skip: true }
      // A suspended provider must stop the pool at the claim, not at the
      // submission. Claiming during a cooldown charges an attempt to every task
      // it touches and hands each one straight back to WAITING — churn that
      // spends the queue's own retry budget on a provider that is refusing
      // everyone. Skipping claims is what "the workers are suspended" means.
      if (chatAgentRateLimitResumeBlocked()) return { skip: true }
      const entry = workerEntryForIndex(worker)
      if (!entry) return { skip: true }
      const blocked = Boolean(entry.interactionWindowId || entry.accountOperationActive || entry.transportPreparationCount > 0 || entry.loading)
      const supervisorLanes = chatSupervisorBoundLanes()
      const residentLane = chatAgentResidency.snapshot(entry.slotId).resident_lane
      const keepFlowing = chatAgentKeepFlowingActive(worker)
      if (!blocked && !keepFlowing && residentLane && supervisorLanes.has(residentLane)) {
        chatAgentResidency.releaseResidentLane(entry.slotId, residentLane)
      }
      const options = chatAgentResidency.claimOptions(entry.slotId, {
        blocked,
        pinResident: chatAgentSupervisingLiveResponse(worker) || keepFlowing,
      })
      // The pool is shared across projects, but a Worker may only take work the
      // operator can actually supervise. This Desktop knows which projects are
      // open in which windows; the durable claim applies that scope so no
      // attempt is charged to reject work (see adr/ADR-0044).
      const scope = {
        project_scoped: true,
        open_projects: projectWindowRegistry.openProjects(),
        excluded_types: manualSuspension.paused ? manualSuspension.task_types : [],
      }
      if (options.skip) return { ...options, ...scope }
      // A Worker pinned to an Orchestrator task claims only that task's lane,
      // and the lanes other Workers are pinned to are closed to everyone else.
      orchestrationTaskPins.retain(chatGPTWorkerEntries.map((candidate) => candidate.slotId))
      const pinnedLane = orchestrationTaskPins.lane(entry.slotId)
      if (pinnedLane) return { ...scope, preferred_lane: pinnedLane, fallback_mode: 'resident_only', excluded_lanes: [] }
      const pinnedElsewhere = orchestrationTaskPins.lanesHeldByOthers(entry.slotId)
      // Residency protects only a live response or an explicit operator pin.
      // Ordinary queued work is global FIFO within its priority band; a warm
      // conversation is an optimization, not a reason to skip older work.
      const fifo = chatAgentSupervisingLiveResponse(worker) || keepFlowing
        ? options : { preferred_lane: '', fallback_mode: 'any', excluded_lanes: [] }
      return { ...fifo, ...scope, excluded_lanes: [...new Set([...pinnedElsewhere, ...(fifo.excluded_lanes || []), ...supervisorLanes])].slice(0, 32) }
    },
    // An empty claim is the only proof a resident lane has run dry. Without it
    // residency never expired, so a slot stayed bound to a chat that had been
    // resolved hours earlier while other conversations held due work.
    onIdle: (worker) => {
      const entry = workerEntryForIndex(worker)
      if (!entry) return
      // A slot between two observations of a live response is not idle, even
      // though its claims find nothing: AWAIT_RESPONSE deliberately returns to
      // WAITING for ~30 seconds so the worker is released. Releasing its lane
      // on that evidence would hand the conversation to another slot, which
      // would reload a page the model is still writing into — the very
      // interruption the resident probe exists to avoid.
      if (chatAgentSupervisingLiveResponse(worker) || chatAgentKeepFlowingActive(worker)) return
      if (orchestrationTaskPins.lane(entry.slotId)) {
        const pinnedTask = orchestrationTaskPins.taskId(entry.slotId)
        if (!orchestrationTaskPins.noteIdle(entry.slotId)) return
        console.log(`[chat-agent] orchestration-pin-released slot=${entry.slotId} task=${pinnedTask} reason=idle`)
        publishChatAgentRuntimeState()
        return
      }
      let released = chatAgentResidency.noteIdleClaim(entry.slotId)
      if (released) console.log(`[chat-agent] residency-released slot=${entry.slotId} reason=idle-lane`)
      // A claim that reaches the backend and finds nothing is proof the
      // scheduler loop itself is healthy again. Without this, a Worker whose
      // last claim attempt failed (worker-error) stayed painted "Com erro"
      // forever once no further task ever landed on it, even though the very
      // next claim succeeded.
      const prior = chatAgentWorkerStates.get(worker)
      if (prior?.error) { chatAgentWorkerStates.set(worker, { ...prior, error: '' }); released = true }
      if (released) publishChatAgentRuntimeState()
    },
    onState: (state) => {
      const worker = Number(state?.worker || 0)
      if (worker) {
        // A Worker pinned to a task keeps following it across rounds: its
        // monitor closes when the pin is released (the task ended), not when
        // one round's claim settles. Closing on every round made an opened
        // follow window vanish while the Worker was still on the same task.
        const monitored = workerEntryForIndex(worker)
        const heldByTask = Boolean(monitored && orchestrationTaskPins.lane(monitored.slotId)) && (state.kind === 'settled' || state.kind === 'task-error')
        if (!heldByTask) closeWorkerMonitorAfterState(monitored, state.kind)
        const prior = chatAgentWorkerStates.get(worker) || { active: true, task: undefined, lastTask: undefined, lastClaimAt: '', error: '' }
        if (state.kind === 'worker-started') chatAgentWorkerStates.set(worker, { ...prior, active: true })
        else if (state.kind === 'worker-stopped') chatAgentWorkerStates.set(worker, { ...prior, active: false, task: undefined })
        else if (state.kind === 'running') chatAgentWorkerStates.set(worker, { ...prior, active: true, task: state.task, lastTask: state.task, lastClaimAt: new Date().toISOString(), error: '' })
        else if (state.kind === 'settled') chatAgentWorkerStates.set(worker, { ...prior, task: undefined, lastTask: state.task || prior.lastTask, lastResult: state.result, error: '' })
        else if (state.kind === 'task-error') chatAgentWorkerStates.set(worker, { ...prior, task: undefined, lastTask: state.task || prior.lastTask, error: String(state?.error?.message || state?.error || '') })
        else if (state.kind === 'worker-error') chatAgentWorkerStates.set(worker, { ...prior, task: undefined, error: String(state?.error?.message || state?.error || '') })
      }
      reconcileChatGPTWorkerPool(workerHost)
      publishChatAgentRuntimeState()
      void refreshChatAgentRuntimeState().then(publishChatAgentRuntimeState).catch(() => undefined)
    },
  })
}
