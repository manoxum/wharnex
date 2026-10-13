export type CodexAsk = {
  id: string; turnId: string; itemId: string; kind: 'questions' | 'command' | 'files' | 'permissions'
  reason: string; command: string; cwd: string; permissions: unknown; availableDecisions: string[]
  questions: Array<{ id: string; header: string; question: string; isSecret?: boolean; isOther?: boolean; options?: Array<{ label: string; description: string }> | null }>
}
export type CodexAnswer = { answers: Record<string, { answers: string[] }> } | { decision: 'accept' | 'decline' | 'cancel' }
export type NativeCodexRequest = {
  projectPath: string; cacheKey: string; sessionId: string; requestId: string; text: string; chatTitle?: string
  model?: string; effort?: string; attachments: DesktopUserAttachment[]; artifacts?: DesktopUserAttachment[]; projectFiles: string[]
  permissionLevel?: import('../contracts').CodexPermissionLevel
}
export type CodexActivity = {
  id: string; type: string; status?: string; command?: string; cwd?: string; aggregatedOutput?: string; exitCode?: number | null
  summary?: string[]; explanation?: string; riskLevel?: string; plan?: Array<{ step: string; status: string }>
  changes?: Array<{ path: string; diff: string; kind: { type: string } }>; server?: string; tool?: string
}
