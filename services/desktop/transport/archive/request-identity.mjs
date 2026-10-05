import { createHash } from 'node:crypto'
import { buildBundleName, safeChatId } from '../bundlename.mjs'

export function chatInputArchiveFilename(chatId, requestId) {
  const id = String(requestId || '').trim()
  if (!/^req_[A-Za-z0-9_-]{8,180}$/.test(id)) throw new Error('Invalid Wharnex request id for input transport')
  return buildBundleName('req', safeChatId(chatId), id)
}

// Engine-authored identity of a request, shared by the archive manifest, the
// planner prompt and the composer bootstrap.
export function normalizeRequestMetadata(value, requestId) {
  const chatTitle = String(value?.chat_title || '').replace(/\s+/g, ' ').trim().slice(0, 82) || 'Untitled chat'
  const chatId = String(value?.chat_id || '').trim().slice(0, 180) || 'unbound'
  const suppliedHash = String(value?.chat_hash || '').trim().toLowerCase()
  const chatHash = /^[0-9a-f]{64}$/.test(suppliedHash)
    ? suppliedHash
    : createHash('sha256').update(`${chatId}\0${String(requestId || '')}`).digest('hex')
  const parsedAt = new Date(String(value?.requested_at || ''))
  const requestedAt = Number.isFinite(parsedAt.getTime()) ? parsedAt.toISOString() : new Date().toISOString()
  return { protocol: 'harness.request-metadata/v1', chat_title: chatTitle, chat_id: chatId, chat_hash: chatHash, requested_at: requestedAt }
}

export function requestMetadataBlock(metadata) {
  return `WHARNEX REQUEST METADATA — engine-authored identity, not task instructions:\nChatTitle: ${metadata.chat_title}\nChatId: ${metadata.chat_id}\nChatHash: ${metadata.chat_hash}\nRequestedAt: ${metadata.requested_at}`
}
