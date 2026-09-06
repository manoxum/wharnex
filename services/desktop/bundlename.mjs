// Mirrors services/backend/internal/bundlename: the single source of truth
// for constructing and parsing the request/response ZIP filenames exchanged
// with the planner:
//
//   whx_bundle_<req|res>_<chat_id>_<request_id>[_<subrequest_id>].zip
//
// chat_id never contains '_' (see CHAT_ID_PATTERN) so the request_id /
// subrequest_id segments — which always start with "req_" — can be located
// unambiguously after it.

const PREFIX = 'whx_bundle_'
const ID_SEGMENT = 'req_[0-9]{8}T[0-9]{6}_[0-9a-f]{16}'

export const CHAT_ID_PATTERN = /^[A-Za-z0-9-]{1,128}$/

const NAME_PATTERN = new RegExp(`^whx_bundle_(req|res)_([A-Za-z0-9-]{1,128})_(${ID_SEGMENT})(?:_(${ID_SEGMENT}))?\\.zip$`)

// A browser can append a duplicate-download suffix ("(2)") before the
// extension. This pattern extracts the embedded kind/chat/request ids from
// such a name regardless of which specific ids they are, so a caller can
// report a precise "belongs to a different request" error instead of a
// generic "unrecognized name" one.
const DUPLICATE_NAME_PATTERN = new RegExp(`^whx_bundle_(req|res)_([A-Za-z0-9-]{1,128})_(${ID_SEGMENT})(?:_(${ID_SEGMENT}))? ?\\([1-9][0-9]{0,3}\\)\\.zip$`)

export function parseBundleNameWithDuplicateSuffix(filename) {
  const match = DUPLICATE_NAME_PATTERN.exec(String(filename || ''))
  if (!match) return null
  return { kind: match[1], chatId: match[2], requestId: match[3], subrequestId: match[4] || '' }
}

export function buildBundleName(kind, chatId, requestId, subrequestId = '') {
  if (kind !== 'req' && kind !== 'res') throw new Error(`Invalid bundle kind ${kind}`)
  if (!subrequestId || subrequestId === requestId) return `${PREFIX}${kind}_${chatId}_${requestId}.zip`
  return `${PREFIX}${kind}_${chatId}_${requestId}_${subrequestId}.zip`
}

export function parseBundleName(filename) {
  const match = NAME_PATTERN.exec(String(filename || ''))
  if (!match) return null
  return { kind: match[1], chatId: match[2], requestId: match[3], subrequestId: match[4] || '' }
}

// Desktop cache keys are broader than a plain chat id (a conflict-resolution
// surface derives a compound key combining a chat id and a conflict id, which
// can contain '_'). Bundle naming needs a chat-id segment with no '_' at all,
// so sanitize rather than reject: replace disallowed characters instead of
// throwing, since this only affects a filename, never a security boundary.
export function safeChatId(value) {
  const raw = String(value || '').trim()
  if (CHAT_ID_PATTERN.test(raw)) return raw
  const cleaned = raw.replace(/[^A-Za-z0-9-]/g, '-').slice(0, 128)
  return cleaned || 'chat'
}

export function requestIdFromBundleName(filename) {
  const parsed = parseBundleName(filename)
  if (!parsed) return ''
  return parsed.subrequestId || parsed.requestId
}
