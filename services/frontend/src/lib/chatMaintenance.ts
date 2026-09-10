import type { WorkspaceChat } from './workspaceMemory'

// Background chat-maintenance jobs. Every decision here is a pure function of
// durable chat state plus the current time so the scheduling rules are testable
// without a browser, a desktop bridge, or a live ChatGPT surface.

export const REMOTE_ARCHIVE_ATTEMPT_CAP = 8
export const CHAT_NAMING_ATTEMPT_CAP = 5
export const LIBRARY_RETENTION_DAYS = 3

const MINUTE = 60_000
const HOUR = 60 * MINUTE

// Bounded exponential backoff: a control that is missing right now is usually
// missing for a while (an auth gate, a UI the account cannot reach), so retrying
// every tick would spend the whole budget re-failing.
export function retryBackoffMs(attempts: number, base = 5 * MINUTE, ceiling = 6 * HOUR) {
  if (attempts <= 0) return 0
  return Math.min(ceiling, base * (2 ** (attempts - 1)))
}

function backoffSatisfied(now: number, attempts: number, lastAttemptAt?: string) {
  if (!attempts) return true
  const last = Date.parse(lastAttemptAt || '')
  if (!Number.isFinite(last)) return true
  return now - last >= retryBackoffMs(attempts)
}

/**
 * Archived chats whose remote ChatGPT archive was never confirmed. The local
 * archive already happened — this is the deferred half of that operation.
 */
export function dueRemoteArchives(archived: WorkspaceChat[], now = Date.now()): WorkspaceChat[] {
  return archived.filter((chat) => {
    if (!chat.chatgptUrl) return false
    const remote = chat.remoteArchive
    if (!remote || remote.state !== 'pending') return false
    if (remote.attempts >= REMOTE_ARCHIVE_ATTEMPT_CAP) return false
    return backoffSatisfied(now, remote.attempts, remote.lastAttemptAt)
  })
}

/**
 * A chat still carrying a provisional, locally-derived title. A title the user
 * typed or the support engine produced is definitive and never revisited.
 */
export function isProvisionallyNamed(chat: WorkspaceChat) {
  if (chat.naming?.state === 'definitive') return false
  if (chat.naming?.state === 'unavailable' && (chat.naming.attempts || 0) >= CHAT_NAMING_ATTEMPT_CAP) return false
  return true
}

export function dueChatNaming(active: WorkspaceChat[], now = Date.now()): WorkspaceChat[] {
  return active.filter((chat) => {
    // Without a bound conversation there is nothing to read a title from and
    // nothing to move into a project.
    if (!chat.chatgptUrl) return false
    if (!isProvisionallyNamed(chat)) return false
    const naming = chat.naming
    if ((naming?.attempts || 0) >= CHAT_NAMING_ATTEMPT_CAP) return false
    return backoffSatisfied(now, naming?.attempts || 0, naming?.lastAttemptAt)
  })
}

/**
 * Chats archived longer than the retention window. Their request/response
 * bundles are still sitting in the account's ChatGPT library consuming remote
 * storage and can be removed.
 */
export function librarPurgeCutoff(now = Date.now(), retentionDays = LIBRARY_RETENTION_DAYS) {
  return now - retentionDays * 24 * HOUR
}

export function duePurgeChatIds(archived: WorkspaceChat[], now = Date.now(), retentionDays = LIBRARY_RETENTION_DAYS): string[] {
  const cutoff = librarPurgeCutoff(now, retentionDays)
  return archived
    .filter((chat) => {
      const archivedAt = Date.parse(chat.archivedAt || '')
      return Number.isFinite(archivedAt) && archivedAt <= cutoff
    })
    .map((chat) => chat.id)
}

/**
 * Whether a library entry may be deleted by the purge job. Ownership is proven
 * by the Wharnex bundle naming convention, which embeds the owning chat id;
 * anything that does not parse as a Wharnex bundle for an expired archived chat
 * is never touched.
 */
export function purgeableLibraryEntry(filename: string, purgeableChatIds: Iterable<string>) {
  const parsed = parseWharnexBundleName(filename)
  if (!parsed) return false
  return new Set(purgeableChatIds).has(parsed.chatId)
}

const BUNDLE_ID_SEGMENT = 'req_[0-9]{8}T[0-9]{6}_[0-9a-f]{16}'
const BUNDLE_NAME = new RegExp(`^whx_bundle_(req|res)_([A-Za-z0-9-]{1,128})_(${BUNDLE_ID_SEGMENT})(?:_(${BUNDLE_ID_SEGMENT}))?\\.zip$`)

// Mirrors services/desktop/bundlename.mjs and internal/bundlename: the single
// naming contract that makes a library entry provably Wharnex-owned.
export function parseWharnexBundleName(filename: string) {
  const match = BUNDLE_NAME.exec(String(filename || ''))
  if (!match) return null
  return { kind: match[1] as 'req' | 'res', chatId: match[2], requestId: match[3], subrequestId: match[4] || '' }
}
