export function desktopBridge() {
  return window.wharnessDesktop
}

export function isDesktop() {
  return Boolean(window.wharnessDesktop)
}

export function elementBounds(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  }
}

export function formatBytes(bytes: number) {
  const value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0
  if (value < 1024) return `${Math.round(value)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let scaled = value / 1024
  for (const unit of units) {
    if (scaled < 1024 || unit === units[units.length - 1]) return `${scaled.toFixed(1)} ${unit}`
    scaled /= 1024
  }
  return `${value} B`
}

export function chatgptConversationURL(value: string) {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    const trusted = url.protocol === 'https:' && (host === 'chatgpt.com' || host.endsWith('.chatgpt.com'))
    if (!trusted) return ''
    const match = /^\/c\/([^/]+)(?:\/.*)?$/.exec(url.pathname)
    if (!match?.[1]) return ''
    return `https://chatgpt.com/c/${match[1]}`
  } catch { return '' }
}


export function isChatGPTNewChatURL(value: string) {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    const trusted = url.protocol === 'https:' && (host === 'chatgpt.com' || host.endsWith('.chatgpt.com'))
    return trusted && (url.pathname === '/' || url.pathname === '')
  } catch { return false }
}

export function chatgptAutoBindingDecision(linkedURL: string | undefined, currentURL: string, loading: boolean, newChatSurfaceSeen: boolean) {
  const linkedConversation = chatgptConversationURL(linkedURL || '')
  if (linkedConversation) return { newChatSurfaceSeen, bindURL: '' }
  if (isChatGPTNewChatURL(currentURL)) return { newChatSurfaceSeen: true, bindURL: '' }
  if (loading) return { newChatSurfaceSeen, bindURL: '' }
  const currentConversation = chatgptConversationURL(currentURL)
  if (newChatSurfaceSeen && currentConversation) return { newChatSurfaceSeen: true, bindURL: currentConversation }
  return { newChatSurfaceSeen, bindURL: '' }
}

export function sameChatGPTConversation(left?: string, right?: string) {
  const a = chatgptConversationURL(left || '')
  const b = chatgptConversationURL(right || '')
  return Boolean(a && b && a === b)
}
