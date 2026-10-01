import { createDesktopSchedulingState } from './state.mjs'

export function createDesktopAgentScheduling(d) {
  const state = d.state || createDesktopSchedulingState(d)
  const policyStore = d.createChatAgentPolicyStore({
    userDataPath: () => d.app.getPath('userData'),
    policies: () => state.chatAgentPolicies,
  })
  const keepFlowing = d.createKeepFlowingState({
    policies: () => state.chatAgentPolicies,
    workerStates: d.chatAgentWorkerStates,
    workerCount: () => d.chatGPTWorkerEntries.length,
    delivered: d.recentlyDeliveredChatGPTBundleRequestId,
    pendingDeliveries: d.pendingChatGPTBundleDeliveries,
    expectedBundles: d.expectedChatGPTBundles,
  })
  const scheduling = d.createChatAgentSchedulingOperations({
    state: {
      get desiredChatAgentWorkerSlots() { return state.desiredChatAgentWorkerSlots },
      set desiredChatAgentWorkerSlots(value) { state.desiredChatAgentWorkerSlots = value },
      get desiredChatAgentSupervisorSlots() { return state.desiredChatAgentSupervisorSlots },
      set desiredChatAgentSupervisorSlots(value) { state.desiredChatAgentSupervisorSlots = value },
      get configuredChatAgentWorkerSlots() { return state.configuredChatAgentWorkerSlots },
      get configuredChatAgentSupervisorSlots() { return state.configuredChatAgentSupervisorSlots },
      get chatAgentWorkerLastGrowAt() { return state.chatAgentWorkerLastGrowAt },
      set chatAgentWorkerLastGrowAt(value) { state.chatAgentWorkerLastGrowAt = value },
      get chatAgentSupervisorLastGrowAt() { return state.chatAgentSupervisorLastGrowAt },
      set chatAgentSupervisorLastGrowAt(value) { state.chatAgentSupervisorLastGrowAt = value },
      get chatAgentRuntimeDiagnostics() { return state.chatAgentRuntimeDiagnostics },
      set chatAgentRuntimeDiagnostics(value) { state.chatAgentRuntimeDiagnostics = value },
      get chatAgentScheduler() { return state.chatAgentScheduler },
      get chatSupervisorScheduler() { return state.chatSupervisorScheduler },
      get chatTranslatorScheduler() { return state.chatTranslatorScheduler },
      get chatAgentPolicies() { return state.chatAgentPolicies },
      get dueChatTranslations() { return state.dueChatTranslations },
      set dueChatTranslations(value) { state.dueChatTranslations = value },
      get quitting() { return state.quitting },
    },
    chatGPTWorkerEntries: d.chatGPTWorkerEntries,
    chatAgentKeepFlowingActive: keepFlowing.active,
    orchestrationTaskPins: d.orchestrationTaskPins,
    chatAgentWorkerStates: d.chatAgentWorkerStates,
    normalizeSupervisorSlotCount: d.normalizeSupervisorSlotCount,
    normalizeWorkerSlotCount: d.normalizeWorkerSlotCount,
    publishChatAgentRuntimeState: d.publishChatAgentRuntimeState,
    chatgptViews: d.chatgptViews,
    chatSupervisorLeaseKeys: d.chatSupervisorLeaseKeys,
    supervisorBindingHeld: d.supervisorBindingHeld,
    chatAgentQueueDiagnostics: d.chatAgentQueueDiagnostics,
    chatAgentRateLimitDelayMs: (...args) => d.chatAgentRateLimitDelayMs(...args),
    autoScaleWorkerDemand: d.autoScaleWorkerDemand,
    autoScaleTarget: d.autoScaleTarget,
    CHAT_AGENT_AUTO_SCALE_DRAIN_COOLDOWN_MS: d.CHAT_AGENT_AUTO_SCALE_DRAIN_COOLDOWN_MS,
    autoScaleDrainTarget: d.autoScaleDrainTarget,
    translatorCapacityTarget: d.translatorCapacityTarget,
    activeChatTranslatorSlots: d.activeChatTranslatorSlots,
    autoScaleSupervisorTarget: d.autoScaleSupervisorTarget,
    autoScaleSupervisorDrainTarget: d.autoScaleSupervisorDrainTarget,
    desktopWindows: d.desktopWindows,
    createChatGPTWorkerView: d.createChatGPTWorkerView,
    retireChatGPTWorkerView: d.retireChatGPTWorkerView,
    wait: d.wait,
    CHAT_AGENT_WORKER_SPAWN_GAP_MS: d.CHAT_AGENT_WORKER_SPAWN_GAP_MS,
    sanitizeChatCacheKey: d.sanitizeChatCacheKey,
    chatAgentLane: d.chatAgentLane,
    chatAgentResidency: d.chatAgentResidency,
    canonicalChatGPTConversationURL: d.canonicalChatGPTConversationURL,
    createChatGPTAffinityTracker: d.createChatGPTAffinityTracker,
    syncChatGPTAffinity: d.syncChatGPTAffinity,
    touchChatGPTEntry: d.touchChatGPTEntry,
    chatAgentLiveBundlePending: d.chatAgentLiveBundlePending,
  })
  const interaction = d.createWorkerInteraction({
    chatGPTWorkerEntries: d.chatGPTWorkerEntries,
    isEphemeralAgentID: (id) => d.getEphemeralAgentID().test(id),
    desktopWindows: d.desktopWindows,
    windowStateForEntry: d.windowStateForEntry,
    grantChatGPTLayoutViewport: (...args) => d.grantChatGPTLayoutViewport(...args),
    publishChatAgentRuntimeState: d.publishChatAgentRuntimeState,
    chatAgentWorkerStates: d.chatAgentWorkerStates,
    normalizeBounds: d.normalizeBounds,
    reconcileChatGPTWorkerPool: (...args) => scheduling.reconcileChatGPTWorkerPool(...args),
  })
  const refresh = d.createChatAgentRuntimeRefresh({
    state: {
      get scheduler() { return state.chatAgentScheduler },
      get desiredWorkerSlots() { return state.desiredChatAgentWorkerSlots },
      get diagnostics() { return state.chatAgentRuntimeDiagnostics },
      set diagnostics(value) { state.chatAgentRuntimeDiagnostics = value },
      get rateLimitUntil() { return state.chatGPTRateLimitUntil },
      set rateLimitUntil(value) { state.chatGPTRateLimitUntil = value },
      get resumeProbeRequired() { return state.chatGPTRateLimitResumeProbeRequired },
      set resumeProbeRequired(value) { state.chatGPTRateLimitResumeProbeRequired = value },
      get rateLimitKind() { return state.chatGPTRateLimitKind },
      set rateLimitKind(value) { state.chatGPTRateLimitKind = value },
      get rateLimitAppliedAt() { return state.chatGPTRateLimitAppliedAt },
      set rateLimitAppliedAt(value) { state.chatGPTRateLimitAppliedAt = value },
    },
    chatGPTWorkerEntries: d.chatGPTWorkerEntries,
    chatAgentWorkerStates: d.chatAgentWorkerStates,
    HARD_MAX_WORKER_SLOTS: d.HARD_MAX_WORKER_SLOTS,
    chatAgentQueueDiagnostics: d.chatAgentQueueDiagnostics,
    runtimeState: () => chatAgentRuntimeState(),
  })
  const publicAgentBrowser = (entry) => d.projectAgentBrowser(entry, d.sanitizeDiagnosticURL)
  function chatAgentRuntimeMemory(agents) {
    try { return d.chatAgentMemorySnapshot(agents, d.app.getAppMetrics()) }
    catch { return d.chatAgentMemorySnapshot(agents, []) }
  }
  function chatAgentRuntimeState() {
    return d.buildChatAgentRuntimeState({
      chatAgentPolicies: state.chatAgentPolicies,
      desiredChatAgentSupervisorSlots: state.desiredChatAgentSupervisorSlots,
      desiredChatAgentWorkerSlots: state.desiredChatAgentWorkerSlots,
      configuredChatAgentSupervisorSlots: state.configuredChatAgentSupervisorSlots,
      configuredChatAgentWorkerSlots: state.configuredChatAgentWorkerSlots,
      chatSupervisorSlotID: d.chatSupervisorSlotID,
      supervisorKeyForSlot: d.supervisorKeyForSlot,
      chatgptViews: d.chatgptViews,
      desktopWindows: d.desktopWindows,
      chatSupervisorStates: d.chatSupervisorStates,
      sanitizeOptionalChatCacheKey: d.sanitizeOptionalChatCacheKey,
      supervisorBindingHold: d.supervisorBindingHold,
      chatGPTWorkerEntries: d.chatGPTWorkerEntries,
      chatAgentWorkerStates: d.chatAgentWorkerStates,
      chatAgentKeepFlowingActive: keepFlowing.active,
      chatAgentKeepFlowingConfigured: keepFlowing.configured,
      orchestrationTaskPins: d.orchestrationTaskPins,
      chatAgentResidency: d.chatAgentResidency,
      chatAgentWorkerActivity: d.chatAgentWorkerActivity,
      EPHEMERAL_AGENT_ID: d.getEphemeralAgentID(),
      EPHEMERAL_WORKER_LABELS: d.getEphemeralWorkerLabels(),
      chatAgentScheduler: state.chatAgentScheduler,
      chatAgentRuntimeDiagnostics: state.chatAgentRuntimeDiagnostics,
      publicAgentBrowser, chatAgentRuntimeMemory,
    })
  }
  async function chatAgentBrowserSnapshot(agentID) {
    const id = String(agentID || '').trim()
    const entry = id === 'supervisor' ? d.supervisorEntry()
      : /^supervisor-[1-9][0-9]?$/.test(id) ? d.supervisorEntryForSlot(id)
        : d.chatGPTWorkerEntries.find((candidate) => candidate.slotId === id)
    const wc = entry?.view?.webContents
    if (!wc || wc.isDestroyed()) throw new Error('Agent browser instance is not available')
    const layoutKey = entry.ownerKey || (entry.role === 'supervisor' ? d.supervisorKey(d.windowStateForEntry(entry)) : entry.slotId || id)
    d.ensureChatGPTLayoutViewport(layoutKey, entry)
    let dataUrl
    try {
      // Every agent view is attached in the browser monitor, so it can be
      // captured where it is; nothing is presented just for the capture.
      dataUrl = await d.captureChatGPTAgentPage(wc)
    } catch (error) {
      const category = String(error?.message || '').includes('excedeu') ? 'deadline' : 'capture-failed'
      console.warn(`[chat-agent-snapshot] agent=${id} category=${category}`)
      throw error
    }
    return { agentId: id, dataUrl, capturedAt: new Date().toISOString() }
  }
  return { policyStore, keepFlowing, ...scheduling, ...interaction, ...refresh, chatAgentRuntimeState, chatAgentBrowserSnapshot }
}
