// Live views over the mutable Desktop runtime state. Domains receive the exact
// fields they read or write through these accessors, never a snapshot, so a
// scheduler created after composition is still the one every domain sees.

export function createDesktopStateAccessors(desktopState) {
  return {
    // Stable runtime collaborators: created once, never reassigned.
    chatAgentResidency: desktopState.agent.chatAgentResidency,
    chatAgentWorkerActivity: desktopState.agent.chatAgentWorkerActivity,
    orchestrationTaskPins: desktopState.agent.orchestrationTaskPins,
    chatGPTWorkerPacer: desktopState.agent.chatGPTWorkerPacer,
    manualChatGPTTransport: desktopState.chatgpt.manualChatGPTTransport,
    chatGPTAccountProviders: desktopState.chatgpt.chatGPTAccountProviders,
    chatGPTUploads: desktopState.chatgpt.chatGPTUploads,
    chatGPTSubmissions: desktopState.chatgpt.chatGPTSubmissions,

    getMainWindow: () => desktopState.window.mainWindow,
    setMainWindow: (window) => { desktopState.window.mainWindow = window },
    isQuitting: () => desktopState.window.quitting,
    getQuitting: () => desktopState.window.quitting,
    setQuitting: (value) => { desktopState.window.quitting = value },
    getExplicitDesktopExit: () => desktopState.window.explicitDesktopExit,
    markExplicitDesktopExit: () => { desktopState.window.explicitDesktopExit = true },
    getTrayControl: () => desktopState.window.desktopTrayControl,
    getDesktopTrayControl: () => desktopState.window.desktopTrayControl,
    setTrayControl: (control) => { desktopState.window.desktopTrayControl = control },

    getScheduler: () => desktopState.agent.chatAgentScheduler,
    getChatAgentScheduler: () => desktopState.agent.chatAgentScheduler,
    getWorkerScheduler: () => desktopState.agent.chatAgentScheduler,
    getTranslatorScheduler: () => desktopState.agent.chatTranslatorScheduler,
    getSupervisorScheduler: () => desktopState.agent.chatSupervisorScheduler,
    getPolicies: () => desktopState.agent.chatAgentPolicies,
    getRuntimeDiagnostics: () => desktopState.agent.chatAgentRuntimeDiagnostics,
    getDesiredChatAgentSupervisorSlots: () => desktopState.agent.desiredChatAgentSupervisorSlots,

    getDeferredSupervisorNavigation: () => desktopState.chatgpt.deferredSupervisorNavigation,
    getRateLimitUntil: () => desktopState.chatgpt.chatGPTRateLimitUntil,
    setRecentExpectedDownload: (value) => { desktopState.chatgpt.recentExpectedDownload = value },
    clearRecentDownload: () => { desktopState.chatgpt.recentExpectedDownload = undefined },
    readPollingChatGPTVisibleActivity: () => desktopState.chatgpt.pollingChatGPTVisibleActivity,
    setPollingChatGPTVisibleActivity: (value) => { desktopState.chatgpt.pollingChatGPTVisibleActivity = value },
  }
}

// One view of the provider rate-limit state shared by health, transport and
// the agent IPC; each consumer touches only the fields it owns.
export function createRateLimitView(desktopState) {
  return {
    get hits() { return desktopState.chatgpt.chatGPTRateLimitHits },
    set hits(value) { desktopState.chatgpt.chatGPTRateLimitHits = value },
    get until() { return desktopState.chatgpt.chatGPTRateLimitUntil },
    set until(value) { desktopState.chatgpt.chatGPTRateLimitUntil = value },
    get kind() { return desktopState.chatgpt.chatGPTRateLimitKind },
    set kind(value) { desktopState.chatgpt.chatGPTRateLimitKind = value },
    get appliedAt() { return desktopState.chatgpt.chatGPTRateLimitAppliedAt },
    set appliedAt(value) { desktopState.chatgpt.chatGPTRateLimitAppliedAt = value },
    get resumeProbeRequired() { return desktopState.chatgpt.chatGPTRateLimitResumeProbeRequired },
    set resumeProbeRequired(value) { desktopState.chatgpt.chatGPTRateLimitResumeProbeRequired = value },
    get resumeProbe() { return desktopState.chatgpt.chatGPTRateLimitResumeProbe },
    set resumeProbe(value) { desktopState.chatgpt.chatGPTRateLimitResumeProbe = value },
    get resumeProbeNotBefore() { return desktopState.chatgpt.chatGPTRateLimitResumeProbeNotBefore },
    set resumeProbeNotBefore(value) { desktopState.chatgpt.chatGPTRateLimitResumeProbeNotBefore = value },
    get policies() { return desktopState.agent.chatAgentPolicies },
    get onAutomationHolds() { return desktopState.chatgpt.chatGPTAutomationHoldsListener },
    set onAutomationHolds(value) { desktopState.chatgpt.chatGPTAutomationHoldsListener = value },
    get scheduler() { return desktopState.agent.chatAgentScheduler },
    get runtimeDiagnostics() { return desktopState.agent.chatAgentRuntimeDiagnostics },
  }
}

// Agent pool configuration and scheduler handles owned by startup and IPC.
export function createAgentRuntimeView(desktopState) {
  return {
    get policies() { return desktopState.agent.chatAgentPolicies },
    set policies(value) { desktopState.agent.chatAgentPolicies = value },
    get scheduler() { return desktopState.agent.chatAgentScheduler },
    get workerScheduler() { return desktopState.agent.chatAgentScheduler },
    set workerScheduler(value) { desktopState.agent.chatAgentScheduler = value },
    set translatorScheduler(value) { desktopState.agent.chatTranslatorScheduler = value },
    set supervisorScheduler(value) { desktopState.agent.chatSupervisorScheduler = value },
    set downloadPoller(value) { desktopState.chatgpt.chatGPTDownloadPoller = value },
    get dueTranslations() { return desktopState.agent.dueChatTranslations },
    get quitting() { return desktopState.window.quitting },
    get supervisorSlots() { return desktopState.agent.configuredChatAgentSupervisorSlots },
    set supervisorSlots(value) { desktopState.agent.configuredChatAgentSupervisorSlots = value },
    get workerSlots() { return desktopState.agent.configuredChatAgentWorkerSlots },
    set workerSlots(value) { desktopState.agent.configuredChatAgentWorkerSlots = value },
    clearRateLimit() {
      desktopState.chatgpt.chatGPTRateLimitUntil = 0
      desktopState.chatgpt.chatGPTRateLimitHits = []
      desktopState.chatgpt.chatGPTRateLimitKind = ''
      desktopState.chatgpt.chatGPTRateLimitAppliedAt = 0
      desktopState.chatgpt.chatGPTRateLimitResumeProbeRequired = false
      desktopState.chatgpt.chatGPTRateLimitResumeProbeNotBefore = 0
    },
  }
}

// The deferred Supervisor navigation slot and its retry timer.
export function createSupervisorNavigationView(desktopState) {
  return {
    get pending() { return desktopState.chatgpt.deferredSupervisorNavigation },
    set pending(value) { desktopState.chatgpt.deferredSupervisorNavigation = value },
    get timer() { return desktopState.chatgpt.deferredSupervisorNavigationTimer },
    set timer(value) { desktopState.chatgpt.deferredSupervisorNavigationTimer = value },
  }
}
