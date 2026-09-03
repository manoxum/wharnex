type DesktopBounds = { x: number; y: number; width: number; height: number }
type DesktopChatGPTState = { cacheKey?: string; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }
type ContextClipboardResult = { ok: boolean; filePath: string; bytes: number }
type DesktopExternalAuthState = { provider: string; url: string }
type DesktopPlanDownload = { filename: string; requestId: string; text: string; bytes: number }
type DesktopPlanDownloadError = { filename?: string; message: string }
type DesktopBundleDownload = { filename: string; requestId: string; contentBase64: string; bytes: number }
type DesktopBundleDownloadError = { filename?: string; message: string }
type DesktopUserAttachment = { name: string; mime?: string; contentBase64: string }
type DesktopStoredAttachment = { name: string; size: number; mime: string; storageRef: string; previewKind: 'thumbnail' | 'icon' | 'none' }
type DesktopAttachmentPreview = { available: boolean; dataUrl: string; previewKind: 'thumbnail' | 'icon' | 'none' }

interface WharnessDesktopBridge {
  platform: string
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
    submitPrompt(request: { cacheKey: string; text: string; url?: string }): Promise<{ ok: boolean; cacheKey: string }>
    preparePrompt(request: { cacheKey: string; text: string; url?: string; sessionId: string; attachments: DesktopUserAttachment[]; autoSubmit?: boolean }): Promise<{ ok: boolean; cacheKey: string; attachmentCount: number; submitted: boolean }>
    submitPrepared(request: { cacheKey: string }): Promise<{ ok: boolean; cacheKey: string }>
    state(): Promise<DesktopChatGPTState>
    openExternal(): Promise<{ ok: boolean }>
    onState(callback: (state: DesktopChatGPTState) => void): () => void
    onExternalAuth(callback: (state: DesktopExternalAuthState) => void): () => void
    onPlanDownloaded(callback: (plan: DesktopPlanDownload) => void): () => void
    onPlanDownloadError(callback: (error: DesktopPlanDownloadError) => void): () => void
    onBundleDownloaded(callback: (bundle: DesktopBundleDownload) => void): () => void
    onBundleDownloadError(callback: (error: DesktopBundleDownloadError) => void): () => void
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
