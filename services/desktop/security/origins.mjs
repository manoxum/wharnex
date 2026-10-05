import { sanitizeSessionId } from './input.mjs'

// Which origins Desktop trusts: local services over HTTP, the ChatGPT HTTPS
// surface, and the external identity providers its login may hand off to.

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

export function isHTTPS(value) {
  try { return new URL(value).protocol === 'https:' } catch { return false }
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
