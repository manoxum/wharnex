import { buildBundleName, parseBundleName, parseBundleNameWithDuplicateSuffix, requestIdFromBundleName, safeChatId } from './bundlename.mjs'

export function sanitizeSessionId(value) {
  const id = String(value || '')
  if (!/^[a-zA-Z0-9_-]{3,160}$/.test(id)) throw new Error('Invalid Wharnex session id')
  return id
}

export function sanitizeChatCacheKey(value) {
  const key = String(value || '').trim()
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(key)) throw new Error('Invalid ChatGPT cache key')
  return key
}

// Runtime projections legitimately have empty slots between scheduler claims.
// Preserve that absence while applying the strict cache-key boundary to every
// non-empty value; callers must not weaken sanitizeChatCacheKey itself.
export function sanitizeOptionalChatCacheKey(value) {
  const key = String(value || '').trim()
  return key ? sanitizeChatCacheKey(key) : ''
}

export function sanitizeAttachmentFilename(value) {
  const name = String(value || '').normalize('NFC').trim()
  if (!name || name === '.' || name === '..' || name.length > 180) throw new Error('Invalid attachment filename')
  if (/[\\/\u0000-\u001f\u007f<>:"|?*]/.test(name) || name.endsWith('.')) throw new Error('Invalid attachment filename')
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('Invalid attachment filename')
  return name
}

export function decodeUserAttachment(value, maxBytes) {
  if (!value || typeof value !== 'object') throw new Error('Invalid attachment')
  const name = sanitizeAttachmentFilename(value.name)
  const source = String(value.contentBase64 || '')
  if (!source || !/^[A-Za-z0-9+/]*={0,2}$/.test(source) || source.length % 4 !== 0) throw new Error(`Attachment ${name} has invalid base64 content`)
  const bytes = Buffer.from(source, 'base64')
  const mime = String(value.mime || '').trim().toLowerCase()
  if (mime.length > 120 || (mime && !/^[a-z0-9!#$&^_.+\-]+\/[a-z0-9!#$&^_.+\-]+$/.test(mime))) throw new Error(`Attachment ${name} has invalid MIME type`)
  if (!bytes.byteLength) throw new Error(`Attachment ${name} is empty`)
  if (bytes.byteLength > maxBytes) throw new Error(`Attachment ${name} exceeds the size limit`)
  if (bytes.toString('base64') !== source) throw new Error(`Attachment ${name} has non-canonical base64 content`)
  return { name, bytes, mime: mime || 'application/octet-stream' }
}

export function chatInputSettleDelay(bytes, attachmentCount) {
  const safeBytes = Math.max(0, Number(bytes) || 0)
  const safeCount = Math.max(0, Math.floor(Number(attachmentCount) || 0))
  const megabytes = Math.ceil(safeBytes / (1024 * 1024))
  return Math.min(30_000, 1_500 + safeCount * 350 + megabytes * 200)
}

export function requireLocalHTTPURL(value, label = 'URL') {
  let url
  try { url = new URL(String(value)) } catch { throw new Error(`${label} is invalid`) }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'
  if (url.protocol !== 'http:' || !local) throw new Error(`${label} must use local HTTP`)
  return url
}

export function contextBundleURL(backendURL, sessionId) {
  const base = requireLocalHTTPURL(backendURL, 'Backend URL')
  const id = sanitizeSessionId(sessionId)
  return new URL(`/api/sessions/${encodeURIComponent(id)}/bundle`, base).href
}

export function normalizeBounds(value, area) {
  if (!value || !area || area.width < 1 || area.height < 1) return null
  const rawX = Math.floor(Number(value.x) || 0)
  const rawY = Math.floor(Number(value.y) || 0)
  const x = Math.max(0, Math.min(rawX, area.width - 1))
  const y = Math.max(0, Math.min(rawY, area.height - 1))
  const width = Math.max(1, Math.min(Math.floor(Number(value.width) || 1), area.width - x))
  const height = Math.max(1, Math.min(Math.floor(Number(value.height) || 1), area.height - y))
  return { x, y, width, height }
}

export function isHTTPS(value) {
  try { return new URL(value).protocol === 'https:' } catch { return false }
}

export function resolveLinuxOzonePlatform(env = {}) {
  const requested = String(env.WHARNESS_OZONE_PLATFORM || '').trim().toLowerCase()
  if (requested === 'x11' || requested === 'wayland') return requested
  if (env.DISPLAY) return 'x11'
  return 'wayland'
}


export function isTrustedChatGPTOrigin(value) {
  try {
    const url = new URL(String(value))
    const host = url.hostname.toLowerCase()
    return url.protocol === 'https:' && (host === 'chatgpt.com' || host.endsWith('.chatgpt.com'))
  } catch {
    return false
  }
}


export function requireTrustedChatGPTURL(value) {
  let url
  try { url = new URL(String(value)) } catch { throw new Error('Invalid ChatGPT URL') }
  if (!isTrustedChatGPTOrigin(url.href)) throw new Error('ChatGPT URL must use a trusted chatgpt.com HTTPS origin')
  if (url.username || url.password) throw new Error('ChatGPT URL credentials are not allowed')
  return url.href
}

export function externalAuthProvider(value) {
  let host
  try { host = new URL(String(value)).hostname.toLowerCase() } catch { return '' }
  if (host === 'auth.openai.com' || host.endsWith('.auth.openai.com') || host === 'auth0.openai.com') return 'OpenAI'
  if (host === 'accounts.google.com' || host.endsWith('.accounts.google.com')) return 'Google'
  if (host === 'login.microsoftonline.com' || host.endsWith('.login.microsoftonline.com') || host === 'login.live.com') return 'Microsoft'
  if (host === 'appleid.apple.com') return 'Apple'
  return ''
}

export function isChatGPTAuthURL(value) {
  try {
    const url = new URL(String(value))
    if (!isTrustedChatGPTOrigin(url.href)) return false
    return url.pathname === '/auth' || url.pathname.startsWith('/auth/')
  } catch { return false }
}

export function sanitizeChatGPTAuthMode(value) {
  const mode = String(value || '').trim().toLowerCase()
  if (mode === 'embedded' || mode === 'external') return mode
  throw new Error('Invalid ChatGPT authentication mode')
}

export function chatGPTNavigationDisposition(value) {
  let url
  try { url = new URL(String(value)) } catch { return { kind: 'deny', provider: '' } }
  if (url.protocol !== 'https:') return { kind: 'deny', provider: '' }
  const provider = externalAuthProvider(url.href)
  if (provider) return { kind: 'external-auth', provider }
  if (isChatGPTAuthURL(url.href)) return { kind: 'chatgpt-auth', provider: 'OpenAI' }
  if (isTrustedChatGPTOrigin(url.href)) return { kind: 'trusted', provider: '' }
  return { kind: 'external', provider: '' }
}


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

export function chromeCompatibleUserAgent(platform = process.platform, chromiumVersion = '152.0.7977.65') {
  const version = String(chromiumVersion || '152.0.7977.65').replace(/[^0-9.]/g, '') || '152.0.7977.65'
  const os = platform === 'win32'
    ? 'Windows NT 10.0; Win64; x64'
    : platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : 'X11; Linux x86_64'
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`
}

export function sanitizeDiagnosticURL(value) {
  try {
    const url = new URL(String(value))
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return '<invalid-url>'
  }
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
