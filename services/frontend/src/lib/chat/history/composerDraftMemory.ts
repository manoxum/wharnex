const COMPOSER_DRAFT_PREFIX = 'kernl.workspace.composer-draft.v1:'
const COMPOSER_STORED_FILE_DRAFT_PREFIX = 'kernl.workspace.composer-file-draft.v1:'
const COMPOSER_DRAFT_SAVE_DELAY_MS = 180
const LEGACY_COMPOSER_DEFAULT_HEIGHT = 180
export const COMPOSER_MIN_HEIGHT = 156
export const COMPOSER_DEFAULT_HEIGHT = 156
export const COMPOSER_MAX_HEIGHT = 420
export type ComposerDraft = { message: string; height: number }
type PendingComposerDraft = { draft: ComposerDraft; timer: ReturnType<typeof setTimeout> }
const pendingComposerDrafts = new Map<string, PendingComposerDraft>()
export type ComposerFileDraft = { attachments: File[]; projectFiles: string[] }
export type ComposerStoredAttachmentDraft = {
  name: string
  size: number
  mime: string
  storageRef: string
  previewKind: 'thumbnail' | 'icon' | 'none'
  lastModified: number
}

const composerFileDrafts = new Map<string, ComposerFileDraft>()

function composerDraftKey(projectPath: string, chatId: string) { return `${projectPath}:${chatId}` }

export function loadComposerDraft(projectPath: string, chatId: string): ComposerDraft {
  const key = composerDraftKey(projectPath, chatId)
  const pending = pendingComposerDrafts.get(key)
  if (pending) return { ...pending.draft }
  try {
    const raw = localStorage.getItem(`${COMPOSER_DRAFT_PREFIX}${key}`)
    const value = raw ? JSON.parse(raw) as Partial<ComposerDraft> : {}
    return normalizeStoredComposerDraft(value)
  } catch { return { message: '', height: COMPOSER_DEFAULT_HEIGHT } }
}

function writeComposerDraft(projectPath: string, chatId: string, draft: ComposerDraft) {
  try { localStorage.setItem(`${COMPOSER_DRAFT_PREFIX}${composerDraftKey(projectPath, chatId)}`, JSON.stringify(normalizeComposerDraft(draft))) } catch { /* best effort */ }
}

export function saveComposerDraft(projectPath: string, chatId: string, draft: ComposerDraft) {
  cancelComposerDraftSave(projectPath, chatId)
  writeComposerDraft(projectPath, chatId, draft)
}

export function scheduleComposerDraftSave(projectPath: string, chatId: string, draft: ComposerDraft) {
  const key = composerDraftKey(projectPath, chatId)
  const current = pendingComposerDrafts.get(key)
  if (current) clearTimeout(current.timer)
  const normalized = normalizeComposerDraft(draft)
  const timer = setTimeout(() => {
    const pending = pendingComposerDrafts.get(key)
    if (!pending || pending.timer !== timer) return
    pendingComposerDrafts.delete(key)
    writeComposerDraft(projectPath, chatId, pending.draft)
  }, COMPOSER_DRAFT_SAVE_DELAY_MS)
  pendingComposerDrafts.set(key, { draft: normalized, timer })
}

export function flushComposerDraftSave(projectPath: string, chatId: string) {
  const key = composerDraftKey(projectPath, chatId)
  const pending = pendingComposerDrafts.get(key)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingComposerDrafts.delete(key)
  writeComposerDraft(projectPath, chatId, pending.draft)
}

export function cancelComposerDraftSave(projectPath: string, chatId: string) {
  const key = composerDraftKey(projectPath, chatId)
  const pending = pendingComposerDrafts.get(key)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingComposerDrafts.delete(key)
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

export function loadComposerStoredFileDraft(projectPath: string, chatId: string): ComposerStoredAttachmentDraft[] {
  try {
    const raw = localStorage.getItem(`${COMPOSER_STORED_FILE_DRAFT_PREFIX}${composerDraftKey(projectPath, chatId)}`)
    const value = raw ? JSON.parse(raw) as { attachments?: unknown[] } : {}
    return (Array.isArray(value.attachments) ? value.attachments : []).flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const candidate = item as Partial<ComposerStoredAttachmentDraft>
      if (typeof candidate.name !== 'string' || !candidate.name || typeof candidate.storageRef !== 'string' || !candidate.storageRef) return []
      const size = Number(candidate.size)
      if (!Number.isFinite(size) || size < 0) return []
      const previewKind: ComposerStoredAttachmentDraft['previewKind'] = candidate.previewKind === 'thumbnail' || candidate.previewKind === 'icon' ? candidate.previewKind : 'none'
      const lastModified = Number(candidate.lastModified)
      const restored: ComposerStoredAttachmentDraft = { name: candidate.name, size, mime: typeof candidate.mime === 'string' && candidate.mime ? candidate.mime : 'application/octet-stream', storageRef: candidate.storageRef, previewKind, lastModified: Number.isFinite(lastModified) && lastModified >= 0 ? lastModified : 0 }
      return [restored]
    }).slice(0, 10)
  } catch { return [] }
}

export function saveComposerStoredFileDraft(projectPath: string, chatId: string, attachments: ComposerStoredAttachmentDraft[]) {
  const key = `${COMPOSER_STORED_FILE_DRAFT_PREFIX}${composerDraftKey(projectPath, chatId)}`
  try {
    if (!attachments.length) { localStorage.removeItem(key); return }
    localStorage.setItem(key, JSON.stringify({ attachments: attachments.slice(0, 10) }))
  } catch { /* best effort */ }
}

export function clearComposerDraft(projectPath: string, chatId: string) {
  const key = composerDraftKey(projectPath, chatId)
  cancelComposerDraftSave(projectPath, chatId)
  try {
    localStorage.removeItem(`${COMPOSER_DRAFT_PREFIX}${key}`)
    localStorage.removeItem(`${COMPOSER_STORED_FILE_DRAFT_PREFIX}${key}`)
  } catch { /* best effort */ }
  composerFileDrafts.delete(key)
}

export function clearEphemeralComposerDrafts() { composerFileDrafts.clear() }

function normalizeStoredComposerDraft(value: Partial<ComposerDraft>): ComposerDraft {
  const height = Number(value.height)
  const migratedHeight = height === LEGACY_COMPOSER_DEFAULT_HEIGHT ? COMPOSER_DEFAULT_HEIGHT : value.height
  return normalizeComposerDraft({ ...value, height: migratedHeight })
}

function normalizeComposerDraft(value: Partial<ComposerDraft>): ComposerDraft {
  return { message: typeof value.message === 'string' ? value.message.slice(0, 20000) : '', height: normalizeComposerHeight(value.height) }
}

function normalizeComposerHeight(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(COMPOSER_MAX_HEIGHT, Math.max(COMPOSER_MIN_HEIGHT, Math.round(number))) : COMPOSER_DEFAULT_HEIGHT
}
