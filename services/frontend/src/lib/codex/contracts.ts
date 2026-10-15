import type { CodexActivity, CodexAsk, CodexAnswer, NativeCodexRequest } from './native/contracts'
export type PlannerEngine = 'chatgpt' | 'codex'
export type CodexPermissionLevel = 'ask' | 'auto' | 'full'
export type PlannerChatConfiguration = { engine?: PlannerEngine; codexModel?: string; codexEffort?: string; codexPermission?: CodexPermissionLevel }
export type CodexTokens = { inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningOutputTokens: number; totalTokens: number }
export type CodexThread = {
  projectPath: string; chatId: string; threadId: string; title: string; requestId: string; model?: string
  status: 'idle' | 'submitting' | 'running' | 'ready' | 'attention' | 'completed' | 'waiting'
  native?: boolean; archiveError?: string; pendingAsks?: CodexAsk[]; activities?: CodexActivity[]; startedAt?: string; completedAt?: string
  accountId?: string; permissionLevel?: CodexPermissionLevel; selfEvolution?: boolean; resumeAvailable?: boolean; pauseReason?: string
  error: string; messages: Array<{ id: string; text: string; role?: 'user' | 'assistant'; changes?: CodexActivity['changes']; requestId?: string; createdAt?: string }>
  tokenUsage: { total: CodexTokens; last: CodexTokens; modelContextWindow: number | null } | null
}
export type CodexLimitWindow = { usedPercent: number; windowDurationMins: number; resetsAt: number }
export type CodexStatus = {
  connected: boolean
  account: { type: string; email: string; planType: string } | null
  rateLimits: { primary: CodexLimitWindow | null; secondary: CodexLimitWindow | null } | null
  usage: { lifetimeTokens: number | null; peakDailyTokens: number | null } | null
  models: Array<{ id: string; model: string; label: string; isDefault: boolean; defaultReasoningEffort?: string; supportedReasoningEfforts?: Array<{ reasoningEffort: string; description: string }> }>
  threads: CodexThread[]
  accounts?: { selected: string; profiles: Array<{ id: string; label: string; account: CodexStatus['account']; rateLimits: CodexStatus['rateLimits'] }> }
}
export type CodexPrepareRequest = Parameters<WharnessDesktopBridge['chatgpt']['preparePrompt']>[0] & { model?: string }
export type CodexBundle = DesktopBundleDownload & { projectPath: string }
export type CodexPrepared = Awaited<ReturnType<WharnessDesktopBridge['chatgpt']['preparePrompt']>>
export interface CodexBridge {
  status(projectPath: string): Promise<CodexStatus>
  login(projectPath: string): Promise<{ started: boolean }>
  logout(projectPath: string): Promise<unknown>
  preparePrompt(request: CodexPrepareRequest): Promise<CodexPrepared>
  prepareNative?(request: NativeCodexRequest): Promise<CodexPrepared>
  answer?(projectPath: string, chatId: string, requestId: string, askId: string, response: CodexAnswer): Promise<{ ok: boolean }>
  cancelNativeRequest?(projectPath: string, chatId: string, requestId: string): Promise<unknown>
  steerNative?(projectPath: string, chatId: string, requestId: string, commentId: string, text: string, attachments: DesktopUserAttachment[]): Promise<{ ok: boolean }>
  resumeNative?(projectPath: string, chatId: string, requestId: string, text?: string): Promise<unknown>
  createAccount?(projectPath: string, label: string): Promise<{ id: string }>
  selectAccount?(projectPath: string, accountId: string): Promise<unknown>
  threads(projectPath: string): Promise<CodexThread[]>
  history(projectPath: string, chatId: string): Promise<CodexThread>
  cancelRequest(projectPath: string, chatId: string, requestId: string): Promise<unknown>
  pendingBundles(projectPath: string): Promise<CodexBundle[]>
  acknowledge(projectPath: string, chatId: string, requestId: string): Promise<unknown>
  subscribe(projectPath: string): Promise<unknown>
  unsubscribe(projectPath: string): Promise<unknown>
  onAccountChange?(callback: () => void): () => void
  onEvent(callback: (thread: CodexThread) => void): () => void
  onBundle(callback: (bundle: CodexBundle) => void): () => void
}
