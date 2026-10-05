// Frontend-only port of services/desktop/bundlename.mjs (itself a mirror of
// services/backend/internal/bundlename), narrowed to the parsing this side
// needs: extracting the request_id from a bundle filename a human manually
// downloaded from ChatGPT and is now uploading back to Wharnex in Manual
// chat transport mode. Never used to construct a filename — only Desktop
// and the backend do that.
//
//   whx_bundle_<req|res>_<chat_id>_<request_id>[_<subrequest_id>].zip

const ID_SEGMENT = '(?:req|orp)_[0-9]{8}T[0-9]{6}_[0-9a-f]{16}'

const NAME_PATTERN = new RegExp(`^whx_bundle_(req|res)_([A-Za-z0-9-]{1,128})_(${ID_SEGMENT})(?:_(${ID_SEGMENT}))?\\.zip$`)

// A browser can append a duplicate-download suffix ("(2)") before the
// extension when the same file is downloaded more than once — tolerate it
// here too, the same way Desktop's own download interception already does.
const DUPLICATE_NAME_PATTERN = new RegExp(`^whx_bundle_(req|res)_([A-Za-z0-9-]{1,128})_(${ID_SEGMENT})(?:_(${ID_SEGMENT}))? ?\\([1-9][0-9]{0,3}\\)\\.zip$`)

export type ParsedBundleName = { kind: 'req' | 'res'; chatId: string; requestId: string; subrequestId: string }

export function parseBundleName(filename: string): ParsedBundleName | null {
  const match = NAME_PATTERN.exec(String(filename || ''))
  if (!match) return null
  return { kind: match[1] as 'req' | 'res', chatId: match[2], requestId: match[3], subrequestId: match[4] || '' }
}

export function parseBundleNameWithDuplicateSuffix(filename: string): ParsedBundleName | null {
  const match = DUPLICATE_NAME_PATTERN.exec(String(filename || ''))
  if (!match) return null
  return { kind: match[1] as 'req' | 'res', chatId: match[2], requestId: match[3], subrequestId: match[4] || '' }
}

/** The request id to submit this bundle under, or '' if the filename does
 *  not match the canonical Wharnex bundle naming (with or without a
 *  browser duplicate-download suffix). */
export function requestIdFromBundleName(filename: string): string {
  const parsed = parseBundleName(filename) || parseBundleNameWithDuplicateSuffix(filename)
  if (!parsed) return ''
  return parsed.subrequestId || parsed.requestId
}

export function expectedResponseBundleName(prompt: string, requestId: string): string {
  const matches = String(prompt || '').match(/whx_bundle_res_[A-Za-z0-9_-]+\.zip/g) || []
  return matches.find((name) => requestIdFromBundleName(name) === requestId) || ''
}
