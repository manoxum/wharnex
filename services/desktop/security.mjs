export function sanitizeSessionId(value) {
  const id = String(value || '')
  if (!/^[a-zA-Z0-9_-]{3,160}$/.test(id)) throw new Error('Invalid Wharness session id')
  return id
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
  if (host === 'accounts.google.com' || host.endsWith('.accounts.google.com')) return 'Google'
  if (host === 'login.microsoftonline.com' || host.endsWith('.login.microsoftonline.com') || host === 'login.live.com') return 'Microsoft'
  if (host === 'appleid.apple.com') return 'Apple'
  return ''
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
