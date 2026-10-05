import { buildBundleName, parseBundleName, parseBundleNameWithDuplicateSuffix, requestIdFromBundleName, safeChatId } from '../transport/bundlename.mjs'

// Downloaded provider artifacts are trusted only by exact canonical name and
// minimal byte shape before the backend validates their content.

export function wharnessBundleRequestIdFromFilename(value) {
  return requestIdFromBundleName(value)
}

// BundleOwnershipError marks a downloaded bundle whose NAME is a perfectly
// valid Wharnex response bundle, but which belongs to a different request or
// chat than the surface that produced the download currently expects.
//
// This is not corruption and not a security failure: it is the normal outcome
// of running several chats at once, or of a bundle arriving after its own
// request was superseded. It used to be handled identically to a malformed
// name — cancel the download and report a transport error — which threw away
// completed model work and, worse, surfaced an error against the newer
// request that had nothing to do with it. Callers distinguish it so the bytes
// can instead be retained for the workspace-wide router, which already knows
// how to find the chat that owns a request id.
export class BundleOwnershipError extends Error {
  constructor(message, { requestId = '', chatId = '', filename = '' } = {}) {
    super(message)
    this.name = 'BundleOwnershipError'
    this.requestId = requestId
    this.chatId = chatId
    this.filename = filename
  }
}

// canonicalWharnessBundleDownload accepts either the exact canonical name, or
// a browser-mangled duplicate-suffix variant "<canonical name minus .zip> (2).zip",
// and normalizes the latter back to canonical form. expectedChatId/expectedRequestId
// pin what this specific pending request is allowed to resolve to; a name
// naming a different chat or request is a hard error, never silently accepted.
export function canonicalWharnessBundleDownload(value, expectedRequestId = '', mimeType = '', expectedChatId = '', expectedFilename = '') {
  const filename = String(value || '').trim()
  const parsed = parseBundleName(filename)
  if (parsed) {
    if (parsed.kind !== 'res') return undefined
    const effectiveRequestId = parsed.subrequestId || parsed.requestId
    if (expectedRequestId && effectiveRequestId !== expectedRequestId) {
      throw new BundleOwnershipError(`Bundle pertence ao pedido ${effectiveRequestId}, mas o pedido ativo é ${expectedRequestId}.`, { requestId: effectiveRequestId, chatId: parsed.chatId, filename })
    }
    // parsed.chatId always comes from a real filename, so it is necessarily
    // already in its sanitized [A-Za-z0-9-]-only form (the naming scheme
    // forbids '_', which is its own field separator — see safeChatId).
    // expectedChatId is a live, potentially unsanitized cache key. Comparing
    // it raw against parsed.chatId would reject a correctly owned bundle.
    if (expectedChatId && parsed.chatId !== safeChatId(expectedChatId)) {
      if (!expectedFilename) throw new BundleOwnershipError(`Bundle pertence ao chat ${parsed.chatId}, mas o chat ativo é ${safeChatId(expectedChatId)}.`, { requestId: effectiveRequestId, chatId: parsed.chatId, filename })
      const expectedParsed = parseBundleName(expectedFilename)
      if (!expectedParsed || parsed.chatId !== expectedParsed.chatId) throw new BundleOwnershipError(`Bundle pertence ao chat ${parsed.chatId}, mas o pedido ativo pertence a ${expectedParsed?.chatId || safeChatId(expectedChatId)}.`, { requestId: effectiveRequestId, chatId: parsed.chatId, filename })
    }
    if (expectedFilename && filename !== expectedFilename) throw new Error(`Bundle tem nome ${filename}, mas o protocolo exige ${expectedFilename}.`)
    return { requestId: effectiveRequestId, filename, normalized: false }
  }

  const expected = String(expectedRequestId || '').trim()
  if (!/^req_[A-Za-z0-9_-]{8,180}$/.test(expected)) return undefined
  const chatId = safeChatId(expectedChatId)
  const canonical = expectedFilename || buildBundleName('res', chatId, expected)
  const duplicate = parseBundleNameWithDuplicateSuffix(filename)
  if (duplicate) {
    if (duplicate.kind !== 'res') {
      throw new Error('Nome do bundle Wharnex contém um request_id ou chat_id inválido e não pode ser normalizado.')
    }
    const duplicateRequestId = duplicate.subrequestId || duplicate.requestId
    if (duplicateRequestId !== expected) {
      throw new BundleOwnershipError(`Bundle pertence ao pedido ${duplicateRequestId}, mas o pedido ativo é ${expected}.`, { requestId: duplicateRequestId, chatId: duplicate.chatId, filename: buildBundleName('res', duplicate.chatId, duplicateRequestId) })
    }
    const expectedParsed = parseBundleName(expectedFilename)
    if (expectedChatId && duplicate.chatId !== safeChatId(expectedChatId) && duplicate.chatId !== expectedParsed?.chatId) {
      throw new BundleOwnershipError(`Bundle pertence ao chat ${duplicate.chatId}, mas o chat ativo é ${chatId}.`, { requestId: duplicateRequestId, chatId: duplicate.chatId, filename: buildBundleName('res', duplicate.chatId, duplicateRequestId) })
    }
    return { requestId: expected, filename: canonical, normalized: true, sourceFilename: filename }
  }
  if (/^whx_bundle_(req|res)_/i.test(filename) || /^wharness-bundle-/i.test(filename)) {
    throw new Error('Nome do bundle Wharnex contém um request_id ou chat_id inválido e não pode ser normalizado.')
  }
  const mime = String(mimeType || '').toLowerCase()
  const zipLike = /\.zip$/i.test(filename) || mime === 'application/zip' || mime === 'application/x-zip-compressed'
  if (!zipLike) return undefined
  return { requestId: expected, filename: canonical, normalized: true, sourceFilename: filename }
}

export function validateWharnessBundleDownload(filename, bytes) {
  const requestId = requestIdFromBundleName(filename)
  if (!requestId) throw new Error('Nome de ficheiro de bundle inválido.')
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || [])
  if (data.byteLength < 4 || data[0] !== 0x50 || data[1] !== 0x4b) throw new Error('O bundle Wharnex não é um ficheiro ZIP válido.')
  return { requestId }
}

export function wharnessPlanRequestIdFromFilename(value) {
  const name = String(value || '')
  const match = /^wharness-plan-(req_[A-Za-z0-9_-]{8,180})\.json$/.exec(name)
  return match ? match[1] : ''
}

export function validateWharnessPlanFile(filename, text) {
  const requestId = wharnessPlanRequestIdFromFilename(filename)
  if (!requestId) throw new Error('Nome de ficheiro de plano inválido.')
  const source = String(text || '').replace(/^\uFEFF/, '').trim()
  if (!source) throw new Error('O ficheiro de plano está vazio.')
  let plan
  try { plan = JSON.parse(source) } catch { throw new Error('O ficheiro de plano não contém JSON válido.') }
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('O ficheiro de plano deve conter um objeto JSON.')
  if (plan.protocol !== 'harness.execution/v1') throw new Error('O ficheiro de plano usa um protocolo inválido.')
  if (plan.request_id !== requestId) throw new Error('O request_id do ficheiro não corresponde ao nome do plano.')
  return { requestId, text: source }
}
