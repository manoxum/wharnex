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
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function chatgptConversationURL(value: string) {
  try {
    const url = new URL(value)
    const trusted = url.protocol === 'https:' && (url.hostname === 'chatgpt.com' || url.hostname.endsWith('.chatgpt.com'))
    if (!trusted || !/\/c\/[^/]+/.test(url.pathname)) return ''
    return `${url.origin}${url.pathname}`
  } catch { return '' }
}
