type DesktopBounds = { x: number; y: number; width: number; height: number }
type DesktopWindowCloseAction = 'background' | 'close-window' | 'close-all' | 'cancel'
type DesktopWindowClosePrompt = { projectPath: string; projectName: string; hasProject: boolean }
type DesktopChatGPTAuthMode = 'embedded' | 'external'
type DesktopChatGPTAffinityPhase = 'unbound' | 'armed' | 'candidate' | 'bound'
type DesktopManualChatGPTInput = { requestId: string; filenames: string[]; bytes: number; pickerArmed: boolean; pickerAttached: boolean; error?: string; prompt?: string }
type DesktopChatGPTState = { cacheKey?: string; surfaceDeferred?: boolean; supervisorId?: string; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; externalAuthProvider?: string; authMode?: DesktopChatGPTAuthMode; authWindowOpen?: boolean; authenticated?: boolean; humanAction?: DesktopChatGPTHumanAction; manualInput?: DesktopManualChatGPTInput; affinityPhase?: DesktopChatGPTAffinityPhase; boundConversationUrl?: string; bindingCandidate?: string }
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
type DesktopCompletionNotification = { id: string; projectPath: string; chatId: string; kind: 'task-completed' | 'restart-pending'; title: string; body: string; occurredAt: string; read?: boolean }
type DesktopTrayAction = 'open-notifications' | 'open-plan' | 'open-execution' | 'approve-execution' | 'pause-execution' | 'resume-execution' | 'suspend-execution' | 'continue-request' | 'open-workers' | 'open-tunnels'
type DesktopTrayProjectState = {
  projectPath: string; activeChatId?: string; status?: string; attentionTotal?: number; actionable?: number; tunnelCount?: number; taskInFlight?: boolean
  canApproveExecution?: boolean; canContinueRequest?: boolean; canControlExecution?: boolean; planControl?: 'active' | 'paused' | 'suspended'
}
type DesktopTrayActionEvent = { projectPath: string; action: DesktopTrayAction }
type DesktopChatGPTAccountAction = { cacheKey: string; action: 'organize' | 'archive' | string; ok: boolean; state: string; provider: 'official-api' | 'typed-browser' | string }
type DesktopUserAttachment = { name: string; mime?: string; contentBase64: string }
type DesktopStoredAttachment = { name: string; size: number; mime: string; storageRef: string; previewKind: 'thumbnail' | 'icon' | 'none' }
type DesktopAttachmentPreview = { available: boolean; dataUrl: string; previewKind: 'thumbnail' | 'icon' | 'none' }
type DesktopStorageUsage = { total_bytes: number; user_data_bytes: number; browser_bytes: number; attachment_bytes: number; temp_bytes: number; other_user_data_bytes: number }
type DesktopBrowserSessionResult = { cancelled: boolean; filename?: string; bytes?: number; files?: number; restarting?: boolean }
type DesktopChatAgentLifecycleRequest = { cacheKey: string; url: string; sessionId?: string; projectId?: string; projectName?: string; title?: string; requestId?: string }
type DesktopChatAgentLifecycleResult = { ok: boolean; state: string; task_id: string; type: string }

interface WharnessDesktopBridge {
  platform: string
  projects: {
    pickDirectory(request?: { title?: string; defaultPath?: string }): Promise<{ cancelled: boolean; path: string }>
    pickImage(request?: { title?: string }): Promise<{ cancelled: boolean; dataURL: string }>
    trash(projectPath: string): Promise<{ ok: boolean; path: string }>
    acquire(projectPath: string): Promise<{ ok: boolean; path: string; ownerWindowId?: string; message?: string }>
    release(projectPath: string): Promise<{ ok: boolean; released: boolean; path: string }>
    activate(projectPath: string): Promise<{ ok: boolean; path: string }>
    bindings(): Promise<{ windowId: string; projects: string[] }>
  }
  windows: {
    info(): Promise<{ windowId: string; windowCount: number }>
    recovery(): Promise<{ active: boolean; projects: string[]; activeProject: string; pending?: boolean }>
    projects(): Promise<{ currentWindowId: string; items: Array<{ windowId: string; projectPath: string; focused: boolean }> }>
    focusProject(projectPath: string): Promise<{ ok: boolean; windowId: string; projectPath: string }>
    onActivateProject(callback: (payload: { projectPath: string }) => void): () => void
    onCloseProject(callback: (payload: { projectPath: string }) => void): () => void
    onCloseConfirmation(callback: (payload: DesktopWindowClosePrompt) => void): () => void
    acknowledgeClose(): Promise<{ ok: boolean; reason?: string }>
    resolveClose(action: DesktopWindowCloseAction): Promise<{ ok: boolean; action?: DesktopWindowCloseAction; reason?: string }>
    open(request?: { projectPath?: string }): Promise<{ ok: boolean; windowId: string }>
    openSurface(request: { projectPath: string; kind: 'chat' | 'editor' | 'terminal'; chatId?: string; path?: string }): Promise<{ ok: boolean; windowId: string }>
    moveSurface(request: { projectPath: string; kind: 'chat' | 'editor' | 'terminal'; chatId?: string; path?: string; screenX?: number; screenY?: number }): Promise<{ ok: boolean; action: 'moved' | 'opened' | 'blocked'; windowId?: string; reason?: string; message?: string }>
    onSurfaceReceived(callback: (payload: { surface: { projectPath: string; kind: 'chat' | 'editor' | 'terminal'; chatId?: string; path?: string } }) => void): () => void
    minimize(): Promise<{ ok: boolean }>
    toggleMaximize(): Promise<{ ok: boolean; maximized: boolean }>
    close(): Promise<{ ok: boolean }>
    activateSelfEvolution(impacts: Array<'backend' | 'frontend' | 'desktop' | 'tunnel'>): Promise<{ ok: boolean; action: 'services' | 'reload' | 'relaunch' }>
  }
  notifications: {
    publish(request: DesktopCompletionNotification): Promise<{ ok: boolean; duplicate: boolean; id: string }>
    onOpen(callback: (notification: DesktopCompletionNotification) => void): () => void
  }
  tray: {
    updateProjectState(request: DesktopTrayProjectState): Promise<{ ok: boolean }>
    onAction(callback: (event: DesktopTrayActionEvent) => void): () => void
  }
  spellcheck: {
    showSuggestions(point: { x: number; y: number }): Promise<{ ok: boolean }>
  }
  chatgpt: {
    show(bounds: DesktopBounds, cacheKey: string, url?: string): Promise<{ ok: boolean }>
    hide(cacheKey: string): Promise<{ ok: boolean }>
    setBounds(bounds: DesktopBounds, cacheKey: string): Promise<{ ok: boolean }>
    // The Engine pane shows a live mirror of the real view in the browser
    // monitor; the user's input on it is forwarded to that view.
    mirrorInput(cacheKey: string, input: DesktopMirrorInput): Promise<{ ok: boolean }>
    // Follows the real view's live stream; call `ready` once a frame is drawn.
    subscribeMirror(cacheKey: string, onFrame: DesktopMirrorFrameHandler): () => void
    navigate(url: string, cacheKey: string, options?: { resetToHomeIfConversation?: boolean; bounds?: DesktopBounds }): Promise<DesktopChatGPTState>
    confirmAffinity(cacheKey: string, conversationUrl: string): Promise<{ ok: boolean; cacheKey: string; conversationUrl: string; affinityPhase: DesktopChatGPTAffinityPhase; boundConversationUrl: string; bindingCandidate: string }>
    rejectAffinity(cacheKey: string, conversationUrl: string): Promise<{ ok: boolean; cacheKey: string; affinityPhase: DesktopChatGPTAffinityPhase; boundConversationUrl: string; bindingCandidate: string }>
    reload(cacheKey: string): Promise<{ ok: boolean }>
    back(cacheKey: string): Promise<{ ok: boolean }>
    forward(cacheKey: string): Promise<{ ok: boolean }>
    paste(cacheKey: string): Promise<{ ok: boolean }>
    openDevTools(cacheKey: string): Promise<{ ok: boolean }>
    submitPrompt(request: { cacheKey: string; sessionId: string; text: string; url?: string; requestId: string }): Promise<{ ok: boolean; cacheKey: string; expectedFilename: string }>
    preparePrompt(request: { cacheKey: string; workspaceChatId?: string; background?: boolean; text: string; bootstrapText?: string; url?: string; sessionId: string; requestId: string; attachments: DesktopUserAttachment[]; artifacts?: DesktopUserAttachment[]; projectFiles?: string[]; autoSubmit?: boolean; contextSha256?: string; lastContextSha256?: string; lastContextChatgptUrl?: string; includeContext?: boolean; preferCurrentConversation?: boolean; firstRequest?: boolean; chatTitle?: string; requestedAt?: string; projectName?: string; projectPath?: string; expectedFilename?: string; reasoningEffort?: 'instant' | 'medium' | 'high'; manualTransport?: boolean }): Promise<{ ok: boolean; cacheKey: string; attachmentCount: number; submitted: boolean; queued?: boolean; expectedFilename: string; includedContext: boolean; conversationUrl?: string; transport?: 'tunnel' | 'remote_channel'; provider?: string; instanceId?: string; expiresAt?: string }>
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
    /** Manual mode keeps the embedded engine live but disables automatic
     *  conversation DOM reads/writes; request bundles are materialized for
     *  explicit human delivery and response downloads remain intercepted. */
    setTransportMode(cacheKey: string, mode: 'scraper' | 'manual'): Promise<{ ok: boolean }>
    copyPendingBundles(cacheKey: string, requestId?: string): Promise<{ ok: boolean; count: number; filenames: string[] }>
    startAuth(cacheKey: string, mode: DesktopChatGPTAuthMode): Promise<DesktopChatGPTState>
    openExternal(url?: string): Promise<{ ok: boolean }>
    openInternal(url?: string): Promise<{ ok: boolean; reused: boolean }>
    resumeEmbedded(cacheKey: string): Promise<DesktopChatGPTState>
    resumeExpectedBundle(request: { cacheKey: string; sessionId: string; requestId: string; url: string; recoveryBootstrap?: string; expectedFilename?: string; chatTitle?: string; chatHash?: string; requestedAt?: string }): Promise<{ ok: boolean; cacheKey: string; requestId: string; expectedFilename: string; reason?: 'write_in_progress' | 'write_not_submitted' | 'resend_required' }>
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
