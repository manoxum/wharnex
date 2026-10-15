import type { CodexThread } from '../../codex/contracts'
import { newWorkspaceChat } from '../../chat/history/workspaceMemory'

export const nativeCompletionFixture = (patch: Partial<CodexThread> = {}): CodexThread => ({
  projectPath: '/project', chatId: 'background', threadId: 'thread', requestId: 'request',
  title: 'Native task', status: 'completed', native: true, error: '', messages: [], tokenUsage: null,
  completedAt: '2026-10-15T10:00:01Z', ...patch,
})
export const nativeChatFixture = { ...newWorkspaceChat('session', 'Segundo chat', 'background'), engine: 'codex' as const }
