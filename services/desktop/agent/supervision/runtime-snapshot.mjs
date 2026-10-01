import { HARD_MAX_SUPERVISOR_SLOTS, HARD_MAX_WORKER_SLOTS, MIN_SUPERVISOR_SLOTS, MIN_WORKER_SLOTS } from '../scheduling/capacity/chat-agent-pool.mjs'
import { workerSuspensionState, workerSuspendsAllTaskTypes } from '../scheduling/capacity/chat-agent-policies.mjs'
import { chatAgentAgentProject, publicChatAgentTask } from './runtime-projection.mjs'

export function buildChatAgentRuntimeState({
  chatAgentPolicies, desiredChatAgentSupervisorSlots, desiredChatAgentWorkerSlots,
  configuredChatAgentSupervisorSlots, configuredChatAgentWorkerSlots,
  chatSupervisorSlotID, supervisorKeyForSlot, chatgptViews, desktopWindows,
  chatSupervisorStates, sanitizeOptionalChatCacheKey, supervisorBindingHold,
  chatGPTWorkerEntries, chatAgentWorkerStates, chatAgentKeepFlowingActive,
  chatAgentKeepFlowingConfigured, orchestrationTaskPins, chatAgentResidency,
  chatAgentWorkerActivity, EPHEMERAL_AGENT_ID, EPHEMERAL_WORKER_LABELS,
  chatAgentScheduler, chatAgentRuntimeDiagnostics, publicAgentBrowser,
  chatAgentRuntimeMemory,
}) {
  const workerPause = workerSuspensionState(chatAgentPolicies)
  const supervisors = Array.from({ length: desiredChatAgentSupervisorSlots }, (_, offset) => {
    const slot = offset + 1
    const id = chatSupervisorSlotID(slot)
    const key = supervisorKeyForSlot(id)
    const entry = key ? chatgptViews.get(key) : undefined
    const active = Boolean(entry && [...desktopWindows.values()].some((state) => state.activeChatGPTKey === entry.ownerKey))
    const runtime = chatSupervisorStates.get(slot) || {}
    // Report the lease whose chat this slot is actually bound to. The execution
    // loops and the renderer bindings are both capped at desiredChatAgentSupervisorSlots
    // but are assigned independently, so pairing them by index would attribute one slot's
    // task to another slot's chat.
    const own = key && sanitizeOptionalChatCacheKey(runtime.task?.chat_id) === key ? runtime : {}
    const hold = key ? supervisorBindingHold(key, entry) : ''
    return {
      id, label: `Supervisor ${slot}`, role: 'supervisor',
      // A held binding is occupancy, not idleness. Supervision spends almost
      // all of its life between observations, with the lease handed back, so
      // deriving the status from the lease alone painted a Supervisor that is
      // mid-request as available on every cycle — and alternated its card
      // between busy and free for the whole length of a request.
      status: own.task ? (String(own.task.status || '').toUpperCase() === 'RUNNING' ? 'running' : 'claimed')
        : runtime.error ? 'error'
        : entry?.transportPreparationCount ? 'running'
        : entry?.loading ? 'loading'
        : hold ? 'claimed'
        : entry ? 'idle' : 'stopped',
      draining: false, loop_active: runtime.active !== false, interacting: active,
      // What this slot is engaged with right now, whether or not it happens to
      // hold the lease at this instant. Rendering the lease alone made the
      // task row appear and disappear on the observation cycle.
      occupied: Boolean(own.task || hold),
      chat_id: String(key || ''), task: publicChatAgentTask(own.task),
      // The owning project of whatever this slot is engaged with. A Supervisor
      // between observations holds no lease, so reading the project from the
      // lease alone left a busy slot looking unattributed — and a panel that
      // cannot name the project cannot offer to bring it into focus.
      project_id: chatAgentAgentProject(own.task, own.lastTask, Boolean(hold)),
      last_task: publicChatAgentTask(own.lastTask), last_claim_at: String(runtime.lastClaimAt || ''),
      binding_hold: hold, error: String(runtime.error || ''), browser: publicAgentBrowser(entry),
    }
  })
  const workers = chatGPTWorkerEntries.filter((entry) => /^worker-[1-9][0-9]?$/.test(entry.slotId)).map((entry) => {
    const worker = Number(entry.slotId.slice(7))
    const runtime = chatAgentWorkerStates.get(worker) || {}
    // A Worker pinned to an Orchestrator task holds it between rounds exactly
    // as a Supervisor holds its chat between observations (adr/ADR-0082):
    // rendering only the lease made it blink between busy and free while the
    // task was still running.
    const pinnedTaskId = orchestrationTaskPins.taskId(entry.slotId)
    return {
      id: entry.slotId || `worker-${worker}`, label: `Worker ${worker}`, role: 'worker',
      status: runtime.task ? (String(runtime.task.status || '').toUpperCase() === 'RUNNING' ? 'running' : 'claimed') : runtime.error ? 'error' : entry.loading ? 'loading' : runtime.active === false ? 'stopped' : chatAgentKeepFlowingActive(worker) || pinnedTaskId ? 'claimed' : 'idle',
      draining: worker > desiredChatAgentWorkerSlots, loop_active: runtime.active !== false, interacting: Boolean(entry.interactionWindowId),
      occupied: Boolean(runtime.task || chatAgentKeepFlowingActive(worker) || pinnedTaskId),
      pinned_task_id: pinnedTaskId,
      monitor_open: Boolean(entry.monitorWindow && !entry.monitorWindow.isDestroyed()),
      chat_id: String(runtime.task?.chat_id || pinnedTaskId || runtime.lastTask?.chat_id || entry.ownerKey || ''), task: publicChatAgentTask(runtime.task),
      project_id: chatAgentAgentProject(runtime.task, runtime.lastTask, chatAgentKeepFlowingActive(worker) || Boolean(pinnedTaskId)),
      last_task: publicChatAgentTask(runtime.lastTask), last_claim_at: String(runtime.lastClaimAt || ''),
      error: String(runtime.error || ''), browser: publicAgentBrowser(entry), residency: chatAgentResidency.snapshot(entry.slotId),
      activity: runtime.task ? chatAgentWorkerActivity.snapshot(entry.slotId) : null,
      keep_flowing: chatAgentKeepFlowingConfigured(worker), keep_flowing_active: chatAgentKeepFlowingActive(worker), suspended: workerSuspendsAllTaskTypes(chatAgentPolicies),
    }
  })
  // Ephemeral utility Workers exist only while their task runs; they are
  // listed so a planning, release-notes or translation task is never seen as
  // unassigned while its own browser is working on it.
  const ephemeral = chatGPTWorkerEntries.filter((entry) => EPHEMERAL_AGENT_ID.test(entry.slotId) && !entry.view.webContents.isDestroyed()).map((entry) => {
    const task = entry.ephemeralTask
    const activity = chatAgentWorkerActivity.snapshot(entry.slotId)
    return {
      id: entry.slotId, label: `Worker efémero · ${EPHEMERAL_WORKER_LABELS[task?.type] || 'Utilitário'}`, role: 'worker', ephemeral: true,
      status: activity ? 'running' : 'claimed', draining: false, loop_active: true, interacting: Boolean(entry.interactionWindowId),
      occupied: true, monitor_open: Boolean(entry.monitorWindow && !entry.monitorWindow.isDestroyed()),
      chat_id: String(task?.chat_id || entry.ownerKey || ''), task: publicChatAgentTask(task), project_id: String(task?.project_id || ''),
      last_task: publicChatAgentTask(task), last_claim_at: '', error: '', browser: publicAgentBrowser(entry), activity,
    }
  })
  const agents = [...supervisors, ...workers, ...ephemeral]
  const memory = chatAgentRuntimeMemory(agents)
  return {
    instance_id: String(chatAgentScheduler?.instanceID || ''),
    desired_supervisors: desiredChatAgentSupervisorSlots,
    configured_supervisors: configuredChatAgentSupervisorSlots,
    desired_workers: desiredChatAgentWorkerSlots,
    configured_workers: configuredChatAgentWorkerSlots,
    policies: {
      ...chatAgentPolicies,
      auto_scaled_supervisors: Math.max(0, desiredChatAgentSupervisorSlots - configuredChatAgentSupervisorSlots),
      auto_scaled_workers: Math.max(0, desiredChatAgentWorkerSlots - configuredChatAgentWorkerSlots),
    },
    limits: {
      min_supervisors: MIN_SUPERVISOR_SLOTS,
      max_supervisors: HARD_MAX_SUPERVISOR_SLOTS,
      min_workers: MIN_WORKER_SLOTS,
      max_workers: HARD_MAX_WORKER_SLOTS,
    },
    scheduler: chatAgentRuntimeDiagnostics.scheduler,
    queue: chatAgentRuntimeDiagnostics.queue,
    provider: chatAgentRuntimeDiagnostics.provider,
    worker_pause: workerPause,
    memory: memory.totals,
    agents: agents.map((agent) => ({ ...agent, memory: memory.by_agent[agent.id] })),
  }
}
