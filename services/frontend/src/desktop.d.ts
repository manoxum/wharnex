type DesktopBounds = { x: number; y: number; width: number; height: number }
type DesktopChatGPTAuthMode = 'embedded' | 'external'
type DesktopChatGPTAffinityPhase = 'unbound' | 'armed' | 'candidate' | 'bound'
type DesktopChatGPTState = { cacheKey?: string; surfaceDeferred?: boolean; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; externalAuthProvider?: string; authMode?: DesktopChatGPTAuthMode; authWindowOpen?: boolean; authenticated?: boolean; humanAction?: DesktopChatGPTHumanAction; affinityPhase?: DesktopChatGPTAffinityPhase; boundConversationUrl?: string; bindingCandidate?: string }
type ContextClipboardResult = { ok: boolean; filePath: string; bytes: number }
type DesktopExternalAuthState = { cacheKey?: string; provider: string; url: string; authMode?: DesktopChatGPTAuthMode; managedWindow?: boolean; managedBrowser?: boolean }
type DesktopAuthCompleteState = { cacheKey?: string; authMode: DesktopChatGPTAuthMode; url: string }
type DesktopAuthErrorState = { cacheKey?: string; provider: string; message: string }
type DesktopPlanDownload = { cacheKey?: string; filename: string; requestId: string; text: string; bytes: number }
type DesktopPlanDownloadError = { cacheKey?: string; filename?: string; message: string }
type DesktopBundleDownload = { cacheKey?: string; filename: string; requestId: string; contentBase64: string; bytes: number; sourceFilename?: string; normalizedFilename?: boolean }
type DesktopBundleDownloadError = { cacheKey?: string; filename?: string; requestId?: string; message?: string; error?: string }
type DesktopChatGPTActivity = { cacheKey?: string; requestId?: string; state: 'idle' | 'thinking'; text: string; capturedAt: string }
type DesktopChatGPTHumanAction = { cacheKey: string; requestId?: string; active: boolean; kind: 'verification' | 'authentication' | 'access' | 'surface' | 'transport' | string; source?: string; message: string; detectedAt: string; open?: boolean }
type DesktopChatGPTCommentStatus = { cacheKey?: string; requestId: string }
type DesktopChatGPTAccountAction = { cacheKey: string; action: 'organize' | 'archive' | string; ok: boolean; state: string; provider: 'official-api' | 'typed-browser' | string }
type DesktopUserAttachment = { name: string; mime?: string; contentBase64: string }
type DesktopStoredAttachment = { name: string; size: number; mime: string; storageRef: string; previewKind: 'thumbnail' | 'icon' | 'none' }
type DesktopAttachmentPreview = { available: boolean; dataUrl: string; previewKind: 'thumbnail' | 'icon' | 'none' }
type DesktopStorageUsage = { total_bytes: number; user_data_bytes: number; browser_bytes: number; attachment_bytes: number; temp_bytes: number; other_user_data_bytes: number }
type DesktopBrowserSessionResult = { cancelled: boolean; filename?: string; bytes?: number; files?: number; restarting?: boolean }
type DesktopAgentRuntimeTask = {
  task_id: string; type: string; chat_id: string; project_id: string; request_id: string; root_request_id: string; conversation_id: string; status: string
  attempt: number; max_attempts: number; assigned_worker: string; keep_flowing: boolean; lease_expires_at: string; not_before: string; last_error: string; created_at: string; updated_at: string
}
type DesktopAgentRuntimeBrowser = { available: boolean; web_contents_id: number; os_process_id?: number; url: string; title: string; loading: boolean }
type DesktopAgentRuntimeResidency = { slot_id: string; resident_lane: string; resident_since: string; min_resident_until: string; assignment_epoch: number; rotation_position: number; navigation_in_progress: boolean; non_preemptive: boolean }
type DesktopAgentRuntimeAgent = {
  id: string; label: string; role: 'supervisor' | 'worker'; status: 'idle' | 'loading' | 'claimed' | 'running' | 'stopped' | 'error' | string
  draining: boolean; loop_active?: boolean; interacting?: boolean; chat_id: string; task?: DesktopAgentRuntimeTask; last_task?: DesktopAgentRuntimeTask; last_claim_at?: string
  keep_flowing?: boolean; keep_flowing_active?: boolean; error: string; browser: DesktopAgentRuntimeBrowser; memory?: { available: boolean; rss_bytes: number; os_process_id: number; shared_process: boolean }; residency?: DesktopAgentRuntimeResidency
  // Whether the slot is engaged right now, independently of whether it happens
  // to hold the lease at this instant. Supervision hands the lease back between
  // observations, so rendering the lease alone made a busy slot alternate
  // between occupied and free for the whole length of a request.
  occupied?: boolean
  suspended?: boolean
  // Canonical host path of the project this slot is working for, carried at
  // agent level for the same reason: a Supervisor between observations has no
  // lease to read it from.
  project_id?: string
  // Why a Supervisor may not release its chat yet (empty when it is free to be
  // rebound): 'expected-bundle' | 'bundle-delivery' | 'queued-comment' |
  // 'transport' | 'account-operation' | 'human-action' | 'external-auth' |
  // 'supervisor-lease' | 'prepared-prompt'.
  binding_hold?: string
}
type DesktopAgentRuntimeState = {
  instance_id: string; desired_supervisors: number; configured_supervisors: number; desired_workers: number; configured_workers: number; policies: { auto_scale: boolean; auto_scale_max_supervisors: number; auto_scale_max_workers: number; keep_flowing_global: boolean; keep_flowing_workers: string[]; workers_suspended: boolean; workers_suspended_until: string; rate_limit_cooldown_minutes: number; auto_scaled_supervisors: number; auto_scaled_workers: number }; limits: { min_supervisors: number; max_supervisors: number; min_workers: number; max_workers: number }
  scheduler: { running: boolean; backend_reachable: boolean; last_refresh_at: string; last_error: string }
  queue: { queued: number; counts: Record<string, number>; due: number; due_supervisor_lanes?: number; due_worker?: number; due_translator?: number; scheduled: number; guarded?: number; blocked: number; oldest_due_created_at: string; next_not_before: string }
  provider: { provider: string; paused: boolean; paused_until: string; reason: string; updated_at: string; rate_limit_level?: number; last_rate_limit_at?: string; last_rate_limit_source?: string; last_valid_bundle_at?: string; average_processing_ms?: number; valid_sample_count?: number; initial_wait_ms?: number }
  worker_pause: { paused: boolean; paused_until: string }
  memory?: { available: boolean; total_workers_bytes: number; total_supervisors_bytes: number; total_agents_bytes: number; desktop_bytes: number; total_bytes: number }
  agents: DesktopAgentRuntimeAgent[]
}
type DesktopChatAgentLifecycleRequest = { cacheKey: string; url: string; sessionId?: string; projectId?: string; projectName?: string; title?: string; requestId?: string }
type DesktopChatAgentLifecycleResult = { ok: boolean; state: string; task_id: string; type: string }

interface WharnessDesktopBridge {
  platform: string
  projects: {
    pickDirectory(request?: { title?: string; defaultPath?: string }): Promise<{ cancelled: boolean; path: string }>
    acquire(projectPath: string): Promise<{ ok: boolean; path: string; ownerWindowId?: string; message?: string }>
    release(projectPath: string): Promise<{ ok: boolean; released: boolean; path: string }>
    activate(projectPath: string): Promise<{ ok: boolean; path: string }>
    bindings(): Promise<{ windowId: string; projects: string[] }>
  }
  windows: {
    info(): Promise<{ windowId: string; windowCount: number }>
    projects(): Promise<{ currentWindowId: string; items: Array<{ windowId: string; projectPath: string; focused: boolean }> }>
    focusProject(projectPath: string): Promise<{ ok: boolean; windowId: string; projectPath: string }>
    onActivateProject(callback: (payload: { projectPath: string }) => void): () => void
    open(): Promise<{ ok: boolean; windowId: string }>
    minimize(): Promise<{ ok: boolean }>
    toggleMaximize(): Promise<{ ok: boolean; maximized: boolean }>
    close(): Promise<{ ok: boolean }>
    prepareRestart(scope: 'all' | 'current'): Promise<{ ok: boolean; scope: 'all' | 'current'; windowCount: number }>
  }
  chatgpt: {
    show(bounds: DesktopBounds, cacheKey: string, url?: string): Promise<{ ok: boolean }>
    hide(cacheKey: string): Promise<{ ok: boolean }>
    setBounds(bounds: DesktopBounds, cacheKey: string): Promise<{ ok: boolean }>
    navigate(url: string, cacheKey: string, options?: { resetToHomeIfConversation?: boolean; bounds?: DesktopBounds }): Promise<DesktopChatGPTState>
    confirmAffinity(cacheKey: string, conversationUrl: string): Promise<{ ok: boolean; cacheKey: string; conversationUrl: string; affinityPhase: DesktopChatGPTAffinityPhase; boundConversationUrl: string; bindingCandidate: string }>
    rejectAffinity(cacheKey: string, conversationUrl: string): Promise<{ ok: boolean; cacheKey: string; affinityPhase: DesktopChatGPTAffinityPhase; boundConversationUrl: string; bindingCandidate: string }>
    reload(cacheKey: string): Promise<{ ok: boolean }>
    back(cacheKey: string): Promise<{ ok: boolean }>
    forward(cacheKey: string): Promise<{ ok: boolean }>
    paste(cacheKey: string): Promise<{ ok: boolean }>
    openDevTools(cacheKey: string): Promise<{ ok: boolean }>
    submitPrompt(request: { cacheKey: string; sessionId: string; text: string; url?: string; requestId: string }): Promise<{ ok: boolean; cacheKey: string; expectedFilename: string }>
    preparePrompt(request: { cacheKey: string; workspaceChatId?: string; background?: boolean; text: string; transport?: { disabledTunnelIds: string[] }; tunnelInstanceIds?: string[]; bootstrapText?: string; url?: string; sessionId: string; requestId: string; attachments: DesktopUserAttachment[]; artifacts?: DesktopUserAttachment[]; projectFiles?: string[]; autoSubmit?: boolean; contextSha256?: string; lastContextSha256?: string; lastContextChatgptUrl?: string; includeContext?: boolean; preferCurrentConversation?: boolean; firstRequest?: boolean; chatTitle?: string; requestedAt?: string; projectName?: string; projectPath?: string; expectedFilename?: string; reasoningEffort?: 'instant' | 'medium' | 'high' }): Promise<{ ok: boolean; cacheKey: string; attachmentCount: number; submitted: boolean; queued?: boolean; expectedFilename: string; includedContext: boolean; conversationUrl?: string; transport?: 'tunnel' | 'remote_channel'; provider?: string; instanceId?: string; expiresAt?: string }>
    retryPreparedPrompt(request: { cacheKey: string; expectedRequestId?: string; sessionId?: string; url?: string; recoveryPrompt?: string; expectedFilename?: string; reasoningEffort?: 'instant' | 'medium' | 'high' }): Promise<{ ok: boolean; cacheKey: string; attachmentCount?: number; submitted?: boolean; expectedFilename?: string; includedContext?: boolean; conversationUrl?: string; requestId?: string; alreadyDelivered?: boolean; alreadySupervised?: boolean; durable?: boolean; transport?: 'tunnel' | 'remote_channel'; provider?: string; instanceId?: string; expiresAt?: string }>
    attachContext(request: { cacheKey: string; sessionId: string; url?: string }): Promise<{ ok: boolean; cacheKey: string; bytes: number; submitted: boolean; conversationUrl?: string }>
    attachPrompt(request: { cacheKey: string; text: string; url?: string }): Promise<{ ok: boolean; cacheKey: string; bytes: number; submitted: boolean; conversationUrl?: string }>
    submitPrepared(request: { cacheKey: string }): Promise<{ ok: boolean; cacheKey: string; expectedFilename: string; conversationUrl?: string }>
    queueComment(request: { cacheKey: string; sessionId: string; text: string; url?: string; requestId: string; commentId?: string; attachments?: DesktopUserAttachment[]; reasoningEffort?: 'instant' | 'medium' | 'high' }): Promise<{ ok: boolean; cacheKey: string; queued: boolean; requestId: string; duplicate?: boolean }>
    state(cacheKey: string): Promise<DesktopChatGPTState>
    release(cacheKey: string): Promise<{ ok: boolean; released: boolean }>
    liveKeys(): Promise<string[]>
    queueArchive(request: DesktopChatAgentLifecycleRequest): Promise<DesktopChatAgentLifecycleResult>
    stopConversation(cacheKey: string): Promise<{ ok: boolean; state: string }>
    cancelRequest(cacheKey: string, requestId: string): Promise<{ ok: boolean; cacheKey: string; requestId: string; cleared: boolean; cancelledTasks: number }>
    queueRename(request: DesktopChatAgentLifecycleRequest): Promise<DesktopChatAgentLifecycleResult>
    queueDelete(request: DesktopChatAgentLifecycleRequest): Promise<DesktopChatAgentLifecycleResult>
    suggestTitle(cacheKey: string, url?: string): Promise<{ ok: boolean; state: string; title: string }>
    hideSidebar(cacheKey: string): Promise<{ ok: boolean; state: string }>
    setAuthMode(cacheKey: string, mode: DesktopChatGPTAuthMode): Promise<DesktopChatGPTState>
    /** Defense in depth for Manual chat transport mode: tells Desktop's own
     *  background polling loops to stop touching this chat's DOM (composer
     *  fill/submit, download interception) even if a bundle was already
     *  armed before the mode changed mid-flight. The primary enforcement is
     *  the frontend never calling preparePrompt at all while manual. */
    setTransportMode(cacheKey: string, mode: 'scraper' | 'manual'): Promise<{ ok: boolean }>
    startAuth(cacheKey: string, mode: DesktopChatGPTAuthMode): Promise<DesktopChatGPTState>
    openExternal(url?: string): Promise<{ ok: boolean }>
    openInternal(url?: string): Promise<{ ok: boolean; reused: boolean }>
    resumeEmbedded(cacheKey: string): Promise<DesktopChatGPTState>
    resumeExpectedBundle(request: { cacheKey: string; sessionId: string; requestId: string; url: string; recoveryBootstrap?: string; expectedFilename?: string; chatTitle?: string; chatHash?: string; requestedAt?: string }): Promise<{ ok: boolean; cacheKey: string; requestId: string; expectedFilename: string }>
    continueExpectedBundle(cacheKey: string, requestId: string, options?: { force?: boolean }): Promise<{ ok: boolean; cacheKey: string; requestId: string; confirmationRequired?: boolean; reason?: string }>
    pickBundle(request: { requestId: string }): Promise<{ cancelled: boolean; filename?: string; requestId?: string; contentBase64?: string; bytes?: number; sourceFilename?: string; normalizedFilename?: boolean }>
    pendingBundles(): Promise<DesktopBundleDownload[]>
    ackBundle(cacheKey: string, requestId: string, filename: string): Promise<{ ok: boolean; requestId: string; alreadyAcknowledged?: boolean }>
    nackBundle(cacheKey: string, requestId: string, filename: string): Promise<{ ok: boolean; requestId: string; retained: boolean }>
    onState(callback: (state: DesktopChatGPTState) => void): () => void
    onExternalAuth(callback: (state: DesktopExternalAuthState) => void): () => void
    onAuthComplete(callback: (state: DesktopAuthCompleteState) => void): () => void
    onAuthError(callback: (state: DesktopAuthErrorState) => void): () => void
    onPlanDownloaded(callback: (plan: DesktopPlanDownload) => void): () => void
    onPlanDownloadError(callback: (error: DesktopPlanDownloadError) => void): () => void
    onBundleDownloaded(callback: (bundle: DesktopBundleDownload) => void): () => void
    onBundleDownloadError(callback: (error: DesktopBundleDownloadError) => void): () => void
    onActivity(callback: (activity: DesktopChatGPTActivity) => void): () => void
    onHumanAction(callback: (notice: DesktopChatGPTHumanAction) => void): () => void
    onAccountAction(callback: (result: DesktopChatGPTAccountAction) => void): () => void
    onCommentSent(callback: (status: DesktopChatGPTCommentStatus) => void): () => void
  }
  agents: {
    state(): Promise<DesktopAgentRuntimeState>
    setSupervisorCount(count: number): Promise<DesktopAgentRuntimeState>
    setWorkerCount(count: number): Promise<DesktopAgentRuntimeState>
    setPolicies(policies: { auto_scale?: boolean; auto_scale_max_supervisors?: number; auto_scale_max_workers?: number; keep_flowing_global?: boolean; rate_limit_cooldown_minutes?: number }): Promise<DesktopAgentRuntimeState>
    setWorkerKeepFlowing(agentId: string, enabled: boolean): Promise<DesktopAgentRuntimeState>
    pauseWorkers(pausedUntil?: string): Promise<DesktopAgentRuntimeState>
    resumeWorkers(): Promise<DesktopAgentRuntimeState>
    pauseProvider(pausedUntil?: string): Promise<DesktopAgentRuntimeState>
    resumeProvider(): Promise<DesktopAgentRuntimeState>
    snapshot(agentId: string): Promise<{ agentId: string; dataUrl: string; capturedAt: string }>
    openDevTools(agentId: string): Promise<{ ok: boolean; agentId: string }>
    openInteraction(agentId: string, bounds: DesktopBounds): Promise<{ ok: boolean; agentId: string; bounds: DesktopBounds }>
    setInteractionBounds(agentId: string, bounds: DesktopBounds): Promise<{ ok: boolean; agentId: string; bounds?: DesktopBounds }>
    closeInteraction(agentId: string): Promise<{ ok: boolean; agentId: string; closed: boolean }>
    onState(callback: (state: DesktopAgentRuntimeState) => void): () => void
  }
  data: {
    storage(): Promise<DesktopStorageUsage>
    exportBrowserSession(): Promise<DesktopBrowserSessionResult>
    importBrowserSession(): Promise<DesktopBrowserSessionResult>
    clearBrowserSession(): Promise<{ ok: boolean }>
    clearAll(confirm: string): Promise<{ ok: boolean }>
  }
  attachments: {
    persist(request: { cacheKey: string; messageId: string; attachments: DesktopUserAttachment[] }): Promise<{ ok: boolean; attachments: DesktopStoredAttachment[] }>
    preview(request: { storageRef: string }): Promise<DesktopAttachmentPreview>
    read(request: { storageRef: string }): Promise<DesktopUserAttachment>
    open(request: { storageRef: string }): Promise<{ ok: boolean }>
    removeChat(request: { cacheKey: string }): Promise<{ ok: boolean }>
  }
  clipboard: {
    copyContextZip(request: { sessionId: string }): Promise<ContextClipboardResult>
    readText(): Promise<string>
    writeText(text: string): Promise<{ ok: boolean }>
  }
}

interface Window { wharnessDesktop?: WharnessDesktopBridge }
