import { CHAT_AGENT_WORKER_TASK_TYPES } from '../capacity/chat-agent-policies.mjs'

export function createChatAgentRuntimeControls({
  getRuntimeState, desktopWindows, sendToWindowState, refreshDesktopTray,
  broadcastDelayMs, state, normalizeChatAgentPolicies, persistChatAgentPolicies,
}) {
  let broadcastTimer
  let migrating = false

  // Per-type suspension moved from this Desktop's local policy to the
  // backend's durable task holds, which every pool's claim honours
  // (ADR-0093). The local selection is carried over exactly once — every
  // Worker type, held or not, so an earlier operator release survives — and
  // then cleared. The whole-pool switch stays local.
  async function migrateWorkerTypeSuspension() {
    const policies = normalizeChatAgentPolicies(state.policies)
    const scheduler = state.scheduler
    if (policies.task_holds_migrated || migrating || !scheduler?.setAutomationHold) return
    migrating = true
    try {
      const scoped = policies.workers_suspended && policies.workers_suspended_types.length > 0
      const until = scoped && policies.workers_suspended_until ? policies.workers_suspended_until : undefined
      for (const type of CHAT_AGENT_WORKER_TASK_TYPES) {
        const active = scoped && policies.workers_suspended_types.includes(type)
        await scheduler.setAutomationHold(`task:${type}`, active
          ? { active, ...(until ? { until } : {}), reason: 'Migrado da suspensão por tipo dos Workers', source: 'desktop-migration' }
          : { active: false })
      }
      state.policies = normalizeChatAgentPolicies({
        ...state.policies, task_holds_migrated: true,
        ...(scoped ? { workers_suspended: false, workers_suspended_until: '', workers_suspended_types: [] } : {}),
      })
      persistChatAgentPolicies()
      console.log(`[chat-agent] worker type suspension migrated to task holds scoped=${scoped}`)
    } catch (error) {
      console.warn(`[chat-agent] task hold migration deferred: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      migrating = false
    }
  }
  let broadcastPending = false
  let latestState

  function publishChatAgentRuntimeState() {
    void migrateWorkerTypeSuspension()
    const current = getRuntimeState()
    latestState = current
    if (!broadcastTimer) {
      for (const windowState of desktopWindows.values()) sendToWindowState(windowState, 'wharness:agents:state', current)
      refreshDesktopTray()
      broadcastTimer = setTimeout(() => {
        broadcastTimer = undefined
        if (!broadcastPending) return
        broadcastPending = false
        for (const windowState of desktopWindows.values()) sendToWindowState(windowState, 'wharness:agents:state', latestState)
        refreshDesktopTray()
      }, broadcastDelayMs)
    } else {
      broadcastPending = true
    }
    return current
  }

  function pauseChatAgentWorkers(request = {}) {
    const rawUntil = String(request?.pausedUntil || '').trim()
    let pausedUntil = ''
    if (rawUntil) {
      const deadline = Date.parse(rawUntil)
      if (!Number.isFinite(deadline)) throw new Error('Worker suspension deadline is invalid')
      if (deadline <= Date.now()) throw new Error('Worker suspension deadline must be in the future')
      pausedUntil = new Date(deadline).toISOString()
    }
    state.policies = normalizeChatAgentPolicies({
      ...state.policies,
      workers_suspended: true,
      workers_suspended_until: pausedUntil,
      // Per-type suspension lives in the backend task holds once migrated;
      // this control is the whole-pool switch.
      workers_suspended_types: state.policies?.task_holds_migrated ? [] : (Array.isArray(request?.taskTypes) ? request.taskTypes : []),
    })
    persistChatAgentPolicies()
    state.scheduler?.wake()
    return publishChatAgentRuntimeState()
  }

  function resumeChatAgentWorkers() {
    state.policies = normalizeChatAgentPolicies({
      ...state.policies, workers_suspended: false, workers_suspended_until: '', workers_suspended_types: [],
    })
    persistChatAgentPolicies()
    state.scheduler?.wake()
    return publishChatAgentRuntimeState()
  }

  return { publishChatAgentRuntimeState, pauseChatAgentWorkers, resumeChatAgentWorkers }
}
