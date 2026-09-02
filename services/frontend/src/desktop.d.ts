type DesktopBounds = { x: number; y: number; width: number; height: number }
type DesktopChatGPTState = { url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }
type ContextClipboardResult = { ok: boolean; filePath: string; bytes: number }
type DesktopExternalAuthState = { provider: string; url: string }

interface WharnessDesktopBridge {
  platform: string
  chatgpt: {
    show(bounds: DesktopBounds): Promise<{ ok: boolean }>
    hide(): Promise<{ ok: boolean }>
    setBounds(bounds: DesktopBounds): Promise<{ ok: boolean }>
    reload(): Promise<{ ok: boolean }>
    focus(): Promise<{ ok: boolean }>
    back(): Promise<{ ok: boolean }>
    forward(): Promise<{ ok: boolean }>
    paste(): Promise<{ ok: boolean }>
    state(): Promise<DesktopChatGPTState>
    openExternal(): Promise<{ ok: boolean }>
    onState(callback: (state: DesktopChatGPTState) => void): () => void
    onExternalAuth(callback: (state: DesktopExternalAuthState) => void): () => void
  }
  clipboard: {
    copyContextZip(request: { sessionId: string }): Promise<ContextClipboardResult>
    readText(): Promise<string>
    writeText(text: string): Promise<{ ok: boolean }>
  }
}

interface Window { wharnessDesktop?: WharnessDesktopBridge }
