import type { AutomationMode, EffortLevel, ChatArtifactSelection, ChatItem, ChatRequestMode, ExecutionMode, HarnessEvent, WorkspaceMode } from '../types'
import { chatgptConversationURL } from './desktop'

const ACTIVE_KEY = 'kernl.workspace.active.v1'
const RECENT_KEY = 'kernl.workspace.recent.v1'
const LEGACY_CHAT_PREFIX = 'kernl.workspace.chat.v1:'
const CHAT_INDEX_PREFIX = 'kernl.workspace.chats.v2:'
const CHAT_ITEMS_PREFIX = 'kernl.workspace.chat.v2:'
const ARCHIVED_CHAT_INDEX_PREFIX = 'kernl.workspace.chats.archived.v1:'
const EXECUTION_MODE_PREFIX = 'kernl.workspace.execution-mode.v1:'
const AUTOMATION_MODE_PREFIX = 'kernl.workspace.automation-mode.v1:'
const EFFORT_LEVEL_PREFIX = 'kernl.workspace.effort-level.v1:'
const EXECUTION_HISTORY_PREFIX = 'kernl.workspace.execution-history.v1:'
const LEGACY_TRANSPORT_OPTIONS_STORAGE_KEY = 'kernl.workspace.transport-options.v2'
export const TRANSPORT_OPTIONS_STORAGE_KEY = 'kernl.workspace.transport-options.v3'

export type TransportOptions = { disabledTunnelIds: string[] }
export const DEFAULT_TRANSPORT_OPTIONS: TransportOptions = { disabledTunnelIds: [] }

export type ActiveWorkspace = {
  sessionId: string
  projectPath: string
  mode: WorkspaceMode
  chatId?: string
  executionMode?: ExecutionMode
  automationMode?: AutomationMode
  effortLevel?: EffortLevel
}

// Remote archival is a best-effort account operation on a surface Wharnex does
// not own the availability of. It is tracked as durable chat state so a failure
// parks the chat for a later retry instead of blocking the local archive, which
// is the authoritative one.
export type RemoteArchiveState = 'pending' | 'archived' | 'not-applicable'

export type RemoteArchive = {
  state: RemoteArchiveState
  attempts: number
  lastState?: string
  lastAttemptAt?: string
}

// Chats start with a title derived locally from the prompt. A definitive title
// is one the support engine produced (or the user typed), which is what the
// naming job looks for.
export type ChatNaming = {
  state: 'provisional' | 'definitive' | 'unavailable'
  attempts: number
  lastAttemptAt?: string
  projectAssigned?: boolean
}

export type WorkspaceChat = {
  id: string
  title: string
  sessionId: string
  chatgptUrl?: string
  remoteArchive?: RemoteArchive
  naming?: ChatNaming
  lastContextSha256?: string
  lastContextChatgptUrl?: string
  artifactSelection?: Partial<ChatArtifactSelection>
  requestMode?: ChatRequestMode
  transport?: TransportOptions
  pendingPlan?: { requestId: string; originalMessage?: string }
  conflictSurfaces?: Record<string, { cacheKey: string; url?: string; resolvedAt?: string }>
  purpose?: 'standard' | 'self-evolution'
  createdAt: string
  updatedAt: string
  archivedAt?: string
}

// Durable wire representation owned by the backend. Fields that are purely a
// renderer concern remain inside `extra`; keeping the conversion here gives
// every caller one lossless identity boundary instead of a growing collection
// of partial, subtly different payloads.
export type DurableWorkspaceChatRecord = {
  id: string
  project_path: string
  session_id: string
  title: string
  chatgpt_url?: string
  archived_at?: string
  created_at: string
  updated_at: string
  extra?: Record<string, unknown>
}

export function durableWorkspaceChat(projectPath: string, chat: WorkspaceChat): DurableWorkspaceChatRecord {
  const {
    id, title, sessionId, chatgptUrl, createdAt, updatedAt, archivedAt,
    ...extra
  } = normalizeWorkspaceChatAffinity(chat)
  return {
    id,
    project_path: projectPath,
    session_id: sessionId,
    title,
    ...(chatgptUrl ? { chatgpt_url: chatgptUrl } : {}),
    ...(archivedAt ? { archived_at: archivedAt } : {}),
    created_at: createdAt,
    updated_at: updatedAt,
    ...(Object.keys(extra).length ? { extra } : {}),
  }
}

function workspaceChatFromDurable(record: DurableWorkspaceChatRecord): WorkspaceChat | undefined {
  const candidate = {
    id: record.id,
    title: record.title,
    sessionId: record.session_id,
    ...(record.chatgpt_url ? { chatgptUrl: record.chatgpt_url } : {}),
    ...((record.extra && typeof record.extra === 'object') ? record.extra : {}),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    ...(record.archived_at ? { archivedAt: record.archived_at } : {}),
  } as WorkspaceChat
  return validChat(candidate) ? normalizeWorkspaceChatAffinity(candidate) : undefined
}

// Local order is an explicit UI choice. Durable rows are authoritative for
// content and affinity, while rows which exist only in durable storage are
// appended so clearing browser data cannot make a chat disappear.
export function mergeDurableWorkspaceChats(local: WorkspaceChat[], durable: DurableWorkspaceChatRecord[]): WorkspaceChat[] {
  const restored = new Map<string, WorkspaceChat>()
  for (const record of durable) {
    const chat = workspaceChatFromDurable(record)
    if (chat) restored.set(chat.id, chat)
  }
  const merged = local.map((chat) => restored.get(chat.id) || normalizeWorkspaceChatAffinity(chat))
  const localIDs = new Set(local.map((chat) => chat.id))
  for (const record of durable) {
    const chat = restored.get(record.id)
    if (chat && !localIDs.has(chat.id)) merged.push(chat)
  }
  return merged.slice(0, 60)
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

export function loadEffortLevel(projectPath: string): EffortLevel {
  try {
    const value = localStorage.getItem(EFFORT_LEVEL_PREFIX + projectPath) as EffortLevel | null
    return value && ['low', 'medium', 'high', 'extra_high', 'max', 'ultra', 'loop'].includes(value) ? value : 'medium'
  } catch { return 'medium' }
}

export function saveEffortLevel(projectPath: string, level: EffortLevel) {
  try { localStorage.setItem(EFFORT_LEVEL_PREFIX + projectPath, level) } catch { /* storage unavailable/full */ }
}

export function loadTransportOptions(): TransportOptions {
  try {
    const raw = localStorage.getItem(TRANSPORT_OPTIONS_STORAGE_KEY) || localStorage.getItem(LEGACY_TRANSPORT_OPTIONS_STORAGE_KEY)
    const value = raw ? JSON.parse(raw) as Partial<TransportOptions> & { liveTunnels?: boolean } : {}
    return normalizeTransportOptions(value)
  } catch { return { ...DEFAULT_TRANSPORT_OPTIONS } }
}

export function saveTransportOptions(value: TransportOptions) {
  const normalized = normalizeTransportOptions(value)
  try { localStorage.setItem(TRANSPORT_OPTIONS_STORAGE_KEY, JSON.stringify(normalized)) } catch { /* storage unavailable/full */ }
}

export function normalizeTransportOptions(value?: Partial<TransportOptions> & { liveTunnels?: boolean }): TransportOptions {
  if (value?.liveTunnels === false) return { disabledTunnelIds: ['*'] }
  const disabledTunnelIds = [...new Set((Array.isArray(value?.disabledTunnelIds) ? value.disabledTunnelIds : []).map((id) => String(id || '').trim()).filter(Boolean))].slice(0, 64)
  return { disabledTunnelIds }
}

export function enabledTunnelIds(value: TransportOptions | undefined, instances: Array<{ id: string; available?: boolean }> = []): string[] {
  const disabled = new Set(normalizeTransportOptions(value).disabledTunnelIds)
  if (disabled.has('*')) return []
  return instances.filter((instance) => instance.available !== false && !disabled.has(instance.id)).map((instance) => instance.id).slice(0, 16)
}

export function loadWorkspaceChats(projectPath: string): WorkspaceChat[] {
  try {
    const raw = localStorage.getItem(CHAT_INDEX_PREFIX + projectPath)
    const parsed = raw ? JSON.parse(raw) as WorkspaceChat[] : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(validChat)
      .map(normalizeWorkspaceChatAffinity)
      .slice(0, 30)
  } catch { return [] }
}

export function saveWorkspaceChats(projectPath: string, chats: WorkspaceChat[]) {
  const normalized = chats.filter(validChat).map(normalizeWorkspaceChatAffinity).slice(0, 30)
  try { localStorage.setItem(CHAT_INDEX_PREFIX + projectPath, JSON.stringify(normalized)) } catch { /* storage unavailable/full */ }
}

export function reorderWorkspaceChats(chats: WorkspaceChat[], sourceChatId: string, targetChatId: string): WorkspaceChat[] {
  if (!sourceChatId || sourceChatId === targetChatId) return chats
  const sourceIndex = chats.findIndex((chat) => chat.id === sourceChatId)
  const targetIndex = chats.findIndex((chat) => chat.id === targetChatId)
  if (sourceIndex < 0 || targetIndex < 0) return chats
  const next = [...chats]
  const [moved] = next.splice(sourceIndex, 1)
  next.splice(targetIndex, 0, moved)
  return next
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

export function newWorkspaceChat(sessionId: string, title = 'Novo chat', id: string = crypto.randomUUID()): WorkspaceChat {
  const now = new Date().toISOString()
  return { id, title, sessionId, createdAt: now, updatedAt: now }
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

export function archiveChat(projectPath: string, chatId: string, remoteArchive?: RemoteArchive) {
  const active = loadWorkspaceChats(projectPath)
  const target = active.find((chat) => chat.id === chatId)
  if (!target) return { active, archived: loadArchivedWorkspaceChats(projectPath) }
  const remaining = active.filter((chat) => chat.id !== chatId)
  const archivedAt = new Date().toISOString()
  const moved: WorkspaceChat = { ...target, updatedAt: archivedAt, archivedAt, ...(remoteArchive ? { remoteArchive } : {}) }
  const archived = [moved, ...loadArchivedWorkspaceChats(projectPath).filter((chat) => chat.id !== chatId)].slice(0, 30)
  saveWorkspaceChats(projectPath, remaining)
  saveArchivedWorkspaceChats(projectPath, archived)
  return { active: remaining, archived }
}

// Records the outcome of a remote-archive attempt on an already-archived chat.
// Kept separate from `archiveChat` because the retry job runs long after the
// local archive that is authoritative for the user.
export function recordRemoteArchiveAttempt(projectPath: string, chatId: string, outcome: { ok: boolean; state: string }) {
  const archived = loadArchivedWorkspaceChats(projectPath)
  const target = archived.find((chat) => chat.id === chatId)
  if (!target) return archived
  const previous = target.remoteArchive
  const remoteArchive: RemoteArchive = {
    state: outcome.ok ? 'archived' : 'pending',
    attempts: (previous?.attempts || 0) + 1,
    lastState: outcome.state,
    lastAttemptAt: new Date().toISOString(),
  }
  const next = archived.map((chat) => chat.id === chatId ? { ...chat, remoteArchive } : chat)
  saveArchivedWorkspaceChats(projectPath, next)
  return next
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
  if (chat.transport) normalized.transport = normalizeTransportOptions(chat.transport as TransportOptions & { liveTunnels?: boolean })
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
const composerFileDrafts = new Map<string, ComposerFileDraft>()
export type ComposerDraft = { message: string; height: number }
export type ComposerFileDraft = { attachments: File[]; projectFiles: string[] }

function composerDraftKey(projectPath: string, chatId: string) { return `${projectPath}:${chatId}` }

export function loadComposerDraft(projectPath: string, chatId: string): ComposerDraft {
  try {
    const raw = localStorage.getItem(`${COMPOSER_DRAFT_PREFIX}${composerDraftKey(projectPath, chatId)}`)
    const value = raw ? JSON.parse(raw) as Partial<ComposerDraft> : {}
    return { message: typeof value.message === 'string' ? value.message : '', height: normalizeComposerHeight(value.height) }
  } catch { return { message: '', height: 156 } }
}

export function saveComposerDraft(projectPath: string, chatId: string, draft: ComposerDraft) {
  try { localStorage.setItem(`${COMPOSER_DRAFT_PREFIX}${composerDraftKey(projectPath, chatId)}`, JSON.stringify({ message: draft.message.slice(0, 20000), height: normalizeComposerHeight(draft.height) })) } catch { /* best effort */ }
}

export function loadComposerFileDraft(projectPath: string, chatId: string): ComposerFileDraft {
  const draft = composerFileDrafts.get(composerDraftKey(projectPath, chatId))
  return draft ? { attachments: [...draft.attachments], projectFiles: [...draft.projectFiles] } : { attachments: [], projectFiles: [] }
}

export function saveComposerFileDraft(projectPath: string, chatId: string, draft: ComposerFileDraft) {
  const key = composerDraftKey(projectPath, chatId)
  if (!draft.attachments.length && !draft.projectFiles.length) { composerFileDrafts.delete(key); return }
  composerFileDrafts.set(key, { attachments: [...draft.attachments], projectFiles: [...draft.projectFiles] })
}

export function clearComposerDraft(projectPath: string, chatId: string) {
  try { localStorage.removeItem(`${COMPOSER_DRAFT_PREFIX}${composerDraftKey(projectPath, chatId)}`) } catch { /* best effort */ }
  composerFileDrafts.delete(composerDraftKey(projectPath, chatId))
}

export function clearEphemeralComposerDrafts() { composerFileDrafts.clear() }

function normalizeComposerHeight(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(420, Math.max(118, Math.round(number))) : 156
}
