export function desktopBridge() {
  let current: Window = window
  for (let depth = 0; depth < 4; depth += 1) {
    try {
      if (current.wharnessDesktop) return current.wharnessDesktop
      if (current.parent === current) return undefined
      current = current.parent
    } catch { return undefined }
  }
  return undefined
}

export function isDesktop() {
  return Boolean(desktopBridge())
}

export function elementBounds(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  let offsetX = 0
  let offsetY = 0
  try {
    const frame = window.frameElement as HTMLElement | null
    if (frame) {
      const frameRect = frame.getBoundingClientRect()
      offsetX = frameRect.left
      offsetY = frameRect.top
    }
  } catch { /* cross-frame offset is best effort */ }
  return {
    x: Math.round(rect.left + offsetX),
    y: Math.round(rect.top + offsetY),
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
    const match = /^\/(?:g\/g-p-[A-Za-z0-9-]{1,256}\/)?c\/([^/]+)(?:\/.*)?$/.exec(url.pathname)
    const id = match?.[1] || ''
    // Creation URLs (`WEB:…`, `local-chatgpt:…`) are provisional; only the
    // durable id charset can become a binding.
    if (!/^[A-Za-z0-9-]{1,128}$/.test(id)) return ''
    return `https://chatgpt.com/c/${id}`
  } catch { return '' }
}


export function sameChatGPTConversation(left?: string, right?: string) {
  const a = chatgptConversationURL(left || '')
  const b = chatgptConversationURL(right || '')
  return Boolean(a && b && a === b)
}
