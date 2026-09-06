import type { AutomationMode, ChatArtifactSelection, ChatItem, ChatRequestMode, ExecutionMode, HarnessEvent, WorkspaceMode } from '../types'
import { chatgptConversationURL } from './desktop'

const ACTIVE_KEY = 'kernl.workspace.active.v1'
const RECENT_KEY = 'kernl.workspace.recent.v1'
const LEGACY_CHAT_PREFIX = 'kernl.workspace.chat.v1:'
const CHAT_INDEX_PREFIX = 'kernl.workspace.chats.v2:'
const CHAT_ITEMS_PREFIX = 'kernl.workspace.chat.v2:'
const ARCHIVED_CHAT_INDEX_PREFIX = 'kernl.workspace.chats.archived.v1:'
const EXECUTION_MODE_PREFIX = 'kernl.workspace.execution-mode.v1:'
const AUTOMATION_MODE_PREFIX = 'kernl.workspace.automation-mode.v1:'
const EXECUTION_HISTORY_PREFIX = 'kernl.workspace.execution-history.v1:'
export const TRANSPORT_OPTIONS_STORAGE_KEY = 'kernl.workspace.transport-options.v2'

export type TransportOptions = { requestArchive: boolean; liveTunnels: boolean }
export const DEFAULT_TRANSPORT_OPTIONS: TransportOptions = { requestArchive: false, liveTunnels: true }

export type ActiveWorkspace = {
  sessionId: string
  projectPath: string
  mode: WorkspaceMode
  chatId?: string
  executionMode?: ExecutionMode
  automationMode?: AutomationMode
}

export type WorkspaceChat = {
  id: string
  title: string
  sessionId: string
  chatgptUrl?: string
  lastContextSha256?: string
  lastContextChatgptUrl?: string
  artifactSelection?: Partial<ChatArtifactSelection>
  requestMode?: ChatRequestMode
  transport?: TransportOptions
  pendingPlan?: { requestId: string; originalMessage: string }
  conflictSurfaces?: Record<string, { cacheKey: string; url?: string; resolvedAt?: string }>
  purpose?: 'standard' | 'self-evolution'
  createdAt: string
  updatedAt: string
  archivedAt?: string
}

export function conflictChatGPTCacheKey(chatId: string, conflictId: string) {
  const clean = `${chatId}_cf_${conflictId}`.replace(/[^A-Za-z0-9_-]/g, '_')
  return clean.slice(0, 128)
}

export function loadActiveWorkspace(): ActiveWorkspace | undefined {
  try {
    const value = localStorage.getItem(ACTIVE_KEY)
    return value ? JSON.parse(value) as ActiveWorkspace : undefined
  } catch { return undefined }
}

export function saveActiveWorkspace(value: ActiveWorkspace) {
  try { localStorage.setItem(ACTIVE_KEY, JSON.stringify(value)) } catch { /* storage may be unavailable/full */ }
  rememberRecent(value.projectPath)
}

export function clearActiveWorkspace() {
  try { localStorage.removeItem(ACTIVE_KEY) } catch { /* storage unavailable */ }
}

export function loadRecentWorkspaces(): string[] {
  try {
    const value = localStorage.getItem(RECENT_KEY)
    const items = value ? JSON.parse(value) as string[] : []
    return Array.isArray(items) ? items.filter((item) => typeof item === 'string').slice(0, 8) : []
  } catch { return [] }
}

export function rememberRecent(projectPath: string) {
  const next = [projectPath, ...loadRecentWorkspaces().filter((item) => item !== projectPath)].slice(0, 8)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* storage unavailable/full */ }
}


export function loadExecutionMode(projectPath: string): ExecutionMode {
  try {
    const value = localStorage.getItem(EXECUTION_MODE_PREFIX + projectPath)
    return value === 'unprotected' ? 'unprotected' : 'protected'
  } catch { return 'protected' }
}

export function saveExecutionMode(projectPath: string, mode: ExecutionMode) {
  try { localStorage.setItem(EXECUTION_MODE_PREFIX + projectPath, mode) } catch { /* storage unavailable/full */ }
}

export function loadAutomationMode(projectPath: string): AutomationMode {
  try { return localStorage.getItem(AUTOMATION_MODE_PREFIX + projectPath) === 'manual' ? 'manual' : 'auto' } catch { return 'auto' }
}

export function saveAutomationMode(projectPath: string, mode: AutomationMode) {
  try { localStorage.setItem(AUTOMATION_MODE_PREFIX + projectPath, mode) } catch { /* storage unavailable/full */ }
}

export function loadTransportOptions(): TransportOptions {
  try {
    const raw = localStorage.getItem(TRANSPORT_OPTIONS_STORAGE_KEY)
    const value = raw ? JSON.parse(raw) as Partial<TransportOptions> : {}
    return normalizeTransportOptions(value)
  } catch { return { ...DEFAULT_TRANSPORT_OPTIONS } }
}

export function saveTransportOptions(value: TransportOptions) {
  const normalized = normalizeTransportOptions(value)
  try { localStorage.setItem(TRANSPORT_OPTIONS_STORAGE_KEY, JSON.stringify(normalized)) } catch { /* storage unavailable/full */ }
}

export function normalizeTransportOptions(value?: Partial<TransportOptions>): TransportOptions {
  const normalized = {
    requestArchive: value?.requestArchive === true,
    liveTunnels: value?.liveTunnels !== false,
  }
  return normalized.requestArchive || normalized.liveTunnels ? normalized : { ...DEFAULT_TRANSPORT_OPTIONS }
}

export function loadWorkspaceChats(projectPath: string): WorkspaceChat[] {
  try {
    const raw = localStorage.getItem(CHAT_INDEX_PREFIX + projectPath)
    const parsed = raw ? JSON.parse(raw) as WorkspaceChat[] : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(validChat)
      .map(normalizeWorkspaceChatAffinity)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 30)
  } catch { return [] }
}

export function saveWorkspaceChats(projectPath: string, chats: WorkspaceChat[]) {
  const normalized = chats.filter(validChat).map(normalizeWorkspaceChatAffinity).slice(0, 30)
  try { localStorage.setItem(CHAT_INDEX_PREFIX + projectPath, JSON.stringify(normalized)) } catch { /* storage unavailable/full */ }
}


export function loadArchivedWorkspaceChats(projectPath: string): WorkspaceChat[] {
  try {
    const raw = localStorage.getItem(ARCHIVED_CHAT_INDEX_PREFIX + projectPath)
    const parsed = raw ? JSON.parse(raw) as WorkspaceChat[] : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter(validChat).map(normalizeWorkspaceChatAffinity).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 30)
  } catch { return [] }
}

export function saveArchivedWorkspaceChats(projectPath: string, chats: WorkspaceChat[]) {
  const normalized = chats.filter(validChat).map(normalizeWorkspaceChatAffinity).slice(0, 30)
  try { localStorage.setItem(ARCHIVED_CHAT_INDEX_PREFIX + projectPath, JSON.stringify(normalized)) } catch { /* storage unavailable/full */ }
}

export function newWorkspaceChat(sessionId: string, title = 'Novo chat'): WorkspaceChat {
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), title, sessionId, createdAt: now, updatedAt: now }
}

export function loadChat(projectPath: string, chatId: string): ChatItem[] {
  try {
    const value = localStorage.getItem(`${CHAT_ITEMS_PREFIX}${projectPath}:${chatId}`)
    const parsed = value ? JSON.parse(value) as ChatItem[] : []
    if (!Array.isArray(parsed)) return []
    const migratedAt = new Date().toISOString()
    return parsed.map((item) => ({ ...item, createdAt: item.createdAt || migratedAt }))
  } catch { return [] }
}

export function saveChat(projectPath: string, chatId: string, items: ChatItem[]) {
  const compact = items.slice(-80).map((item) => ({ ...item, text: item.text.slice(0, 12000), meta: item.meta?.slice(0, 1000) }))
  try { localStorage.setItem(`${CHAT_ITEMS_PREFIX}${projectPath}:${chatId}`, JSON.stringify(compact)) } catch { /* storage unavailable/full */ }
}

export function archiveChat(projectPath: string, chatId: string) {
  const active = loadWorkspaceChats(projectPath)
  const target = active.find((chat) => chat.id === chatId)
  if (!target) return { active, archived: loadArchivedWorkspaceChats(projectPath) }
  const remaining = active.filter((chat) => chat.id !== chatId)
  const archivedAt = new Date().toISOString()
  const archived = [{ ...target, updatedAt: archivedAt, archivedAt }, ...loadArchivedWorkspaceChats(projectPath).filter((chat) => chat.id !== chatId)].slice(0, 30)
  saveWorkspaceChats(projectPath, remaining)
  saveArchivedWorkspaceChats(projectPath, archived)
  return { active: remaining, archived }
}

export function restoreArchivedChat(projectPath: string, chatId: string) {
  const archived = loadArchivedWorkspaceChats(projectPath)
  const target = archived.find((chat) => chat.id === chatId)
  if (!target) return { active: loadWorkspaceChats(projectPath), archived }
  const remainingArchived = archived.filter((chat) => chat.id !== chatId)
  const active = [{ ...target, updatedAt: new Date().toISOString() }, ...loadWorkspaceChats(projectPath).filter((chat) => chat.id !== chatId)].slice(0, 30)
  saveArchivedWorkspaceChats(projectPath, remainingArchived)
  saveWorkspaceChats(projectPath, active)
  return { active, archived: remainingArchived }
}

export function removeArchivedChat(projectPath: string, chatId: string) {
  try {
    localStorage.removeItem(`${CHAT_ITEMS_PREFIX}${projectPath}:${chatId}`)
    localStorage.removeItem(`${EXECUTION_HISTORY_PREFIX}${projectPath}:${chatId}`)
  } catch { /* storage unavailable */ }
  const archived = loadArchivedWorkspaceChats(projectPath).filter((chat) => chat.id !== chatId)
  saveArchivedWorkspaceChats(projectPath, archived)
  return archived
}


export function loadExecutionHistory(projectPath: string, chatId: string): HarnessEvent[] {
  try {
    const raw = localStorage.getItem(`${EXECUTION_HISTORY_PREFIX}${projectPath}:${chatId}`)
    const parsed = raw ? JSON.parse(raw) as HarnessEvent[] : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter(validEvent).slice(-500)
  } catch { return [] }
}

export function saveExecutionHistory(projectPath: string, chatId: string, events: HarnessEvent[]) {
  const compact = events.filter(validEvent).slice(-500).map((event) => ({
    ...event,
    data: compactEventData(event.data),
  }))
  try { localStorage.setItem(`${EXECUTION_HISTORY_PREFIX}${projectPath}:${chatId}`, JSON.stringify(compact)) } catch { /* storage unavailable/full */ }
}

export function loadLegacyChat(projectPath: string): ChatItem[] {
  try {
    const value = localStorage.getItem(LEGACY_CHAT_PREFIX + projectPath)
    return value ? JSON.parse(value) as ChatItem[] : []
  } catch { return [] }
}

export function deriveChatTitle(message: string) {
  const compact = message.replace(/\s+/g, ' ').trim()
  if (!compact) return 'Novo chat'
  return compact.length > 46 ? `${compact.slice(0, 43)}…` : compact
}

function validChat(value: WorkspaceChat) {
  return Boolean(value && typeof value.id === 'string' && typeof value.title === 'string' && typeof value.sessionId === 'string' && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string')
}

function normalizeWorkspaceChatAffinity(chat: WorkspaceChat): WorkspaceChat {
  const normalized = { ...chat }
  const chatgptUrl = chatgptConversationURL(chat.chatgptUrl || '')
  const lastContextChatgptUrl = chatgptConversationURL(chat.lastContextChatgptUrl || '')
  if (chatgptUrl) normalized.chatgptUrl = chatgptUrl
  else delete normalized.chatgptUrl
  if (lastContextChatgptUrl) normalized.lastContextChatgptUrl = lastContextChatgptUrl
  else delete normalized.lastContextChatgptUrl
	if (chat.conflictSurfaces && typeof chat.conflictSurfaces === 'object') {
		const surfaces: NonNullable<WorkspaceChat['conflictSurfaces']> = {}
		for (const [id, surface] of Object.entries(chat.conflictSurfaces)) {
			if (!id || !surface || typeof surface.cacheKey !== 'string') continue
			const url = chatgptConversationURL(surface.url || '')
			surfaces[id] = { cacheKey: conflictChatGPTCacheKey(chat.id, id), ...(url ? { url } : {}), ...(surface.resolvedAt ? { resolvedAt: surface.resolvedAt } : {}) }
		}
		normalized.conflictSurfaces = surfaces
	} else delete normalized.conflictSurfaces
  return normalized
}

function validEvent(value: HarnessEvent) {
  return Boolean(value && typeof value.id === 'string' && typeof value.session_id === 'string' && typeof value.type === 'string' && typeof value.timestamp === 'string' && value.data && typeof value.data === 'object')
}

function compactEventData(data: Record<string, unknown>) {
  const compact: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data || {})) {
    if (typeof value === 'string') compact[key] = value.slice(0, 12000)
    else if (Array.isArray(value)) compact[key] = value.slice(0, 40)
    else if (typeof value === 'number' || typeof value === 'boolean' || value == null) compact[key] = value
  }
  return compact
}

const COMPOSER_DRAFT_PREFIX = 'kernl.workspace.composer-draft.v1:'
export type ComposerDraft = { message: string; height: number }

export function loadComposerDraft(projectPath: string, chatId: string): ComposerDraft {
  try {
    const raw = localStorage.getItem(`${COMPOSER_DRAFT_PREFIX}${projectPath}:${chatId}`)
    const value = raw ? JSON.parse(raw) as Partial<ComposerDraft> : {}
    return { message: typeof value.message === 'string' ? value.message : '', height: normalizeComposerHeight(value.height) }
  } catch { return { message: '', height: 156 } }
}

export function saveComposerDraft(projectPath: string, chatId: string, draft: ComposerDraft) {
  try { localStorage.setItem(`${COMPOSER_DRAFT_PREFIX}${projectPath}:${chatId}`, JSON.stringify({ message: draft.message.slice(0, 20000), height: normalizeComposerHeight(draft.height) })) } catch { /* best effort */ }
}

export function clearComposerDraft(projectPath: string, chatId: string) {
  try { localStorage.removeItem(`${COMPOSER_DRAFT_PREFIX}${projectPath}:${chatId}`) } catch { /* best effort */ }
}

function normalizeComposerHeight(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(420, Math.max(118, Math.round(number))) : 156
}
