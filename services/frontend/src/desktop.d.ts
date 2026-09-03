type DesktopBounds = { x: number; y: number; width: number; height: number }
type DesktopChatGPTAuthMode = 'embedded' | 'external'
type DesktopChatGPTState = { cacheKey?: string; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; externalAuthProvider?: string; authMode?: DesktopChatGPTAuthMode; authWindowOpen?: boolean }
type ContextClipboardResult = { ok: boolean; filePath: string; bytes: number }
type DesktopExternalAuthState = { cacheKey?: string; provider: string; url: string; authMode?: DesktopChatGPTAuthMode; managedWindow?: boolean; managedBrowser?: boolean }
type DesktopAuthCompleteState = { cacheKey?: string; authMode: DesktopChatGPTAuthMode; url: string }
type DesktopAuthErrorState = { cacheKey?: string; provider: string; message: string }
type DesktopPlanDownload = { filename: string; requestId: string; text: string; bytes: number }
type DesktopPlanDownloadError = { filename?: string; message: string }
type DesktopBundleDownload = { filename: string; requestId: string; contentBase64: string; bytes: number; sourceFilename?: string; normalizedFilename?: boolean }
type DesktopBundleDownloadError = { filename?: string; message: string }
type DesktopUserAttachment = { name: string; mime?: string; contentBase64: string }
type DesktopStoredAttachment = { name: string; size: number; mime: string; storageRef: string; previewKind: 'thumbnail' | 'icon' | 'none' }
type DesktopAttachmentPreview = { available: boolean; dataUrl: string; previewKind: 'thumbnail' | 'icon' | 'none' }
type DesktopStorageUsage = { total_bytes: number; user_data_bytes: number; browser_bytes: number; attachment_bytes: number; temp_bytes: number; other_user_data_bytes: number }
type DesktopBrowserSessionResult = { cancelled: boolean; filename?: string; bytes?: number; files?: number; restarting?: boolean }

interface WharnessDesktopBridge {
  platform: string
  projects: {
    pickDirectory(request?: { title?: string; defaultPath?: string }): Promise<{ cancelled: boolean; path: string }>
  }
  chatgpt: {
    show(bounds: DesktopBounds, cacheKey: string): Promise<{ ok: boolean }>
    hide(): Promise<{ ok: boolean }>
    setBounds(bounds: DesktopBounds): Promise<{ ok: boolean }>
    navigate(url: string, cacheKey: string, options?: { resetToHomeIfConversation?: boolean }): Promise<DesktopChatGPTState>
    reload(): Promise<{ ok: boolean }>
    focus(): Promise<{ ok: boolean }>
    back(): Promise<{ ok: boolean }>
    forward(): Promise<{ ok: boolean }>
    paste(): Promise<{ ok: boolean }>
    submitPrompt(request: { cacheKey: string; text: string; url?: string; requestId: string }): Promise<{ ok: boolean; cacheKey: string; expectedFilename: string }>
    preparePrompt(request: { cacheKey: string; text: string; url?: string; sessionId: string; requestId: string; attachments: DesktopUserAttachment[]; autoSubmit?: boolean; contextSha256?: string; lastContextSha256?: string; lastContextChatgptUrl?: string; includeContext?: boolean; preferCurrentConversation?: boolean }): Promise<{ ok: boolean; cacheKey: string; attachmentCount: number; submitted: boolean; expectedFilename: string; includedContext: boolean; conversationUrl?: string }>
    attachContext(request: { cacheKey: string; sessionId: string; url?: string }): Promise<{ ok: boolean; cacheKey: string; bytes: number; submitted: boolean; conversationUrl?: string }>
    attachPrompt(request: { cacheKey: string; text: string; url?: string }): Promise<{ ok: boolean; cacheKey: string; bytes: number; submitted: boolean; conversationUrl?: string }>
    submitPrepared(request: { cacheKey: string }): Promise<{ ok: boolean; cacheKey: string; expectedFilename: string }>
    state(): Promise<DesktopChatGPTState>
    setAuthMode(cacheKey: string, mode: DesktopChatGPTAuthMode): Promise<DesktopChatGPTState>
    startAuth(cacheKey: string, mode: DesktopChatGPTAuthMode): Promise<DesktopChatGPTState>
    openExternal(url?: string): Promise<{ ok: boolean }>
    resumeEmbedded(cacheKey: string): Promise<DesktopChatGPTState>
    pickBundle(request: { requestId: string }): Promise<{ cancelled: boolean; filename?: string; requestId?: string; contentBase64?: string; bytes?: number; sourceFilename?: string; normalizedFilename?: boolean }>
    onState(callback: (state: DesktopChatGPTState) => void): () => void
    onExternalAuth(callback: (state: DesktopExternalAuthState) => void): () => void
    onAuthComplete(callback: (state: DesktopAuthCompleteState) => void): () => void
    onAuthError(callback: (state: DesktopAuthErrorState) => void): () => void
    onPlanDownloaded(callback: (plan: DesktopPlanDownload) => void): () => void
    onPlanDownloadError(callback: (error: DesktopPlanDownloadError) => void): () => void
    onBundleDownloaded(callback: (bundle: DesktopBundleDownload) => void): () => void
    onBundleDownloadError(callback: (error: DesktopBundleDownloadError) => void): () => void
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
