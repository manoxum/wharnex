export const CHATGPT_OVERLAY_SELECTOR = '[data-chatgpt-overlay-blocker="true"]'

export function chatGPTOverlayDocuments(currentWindow: Window): Document[] {
  const documents = [currentWindow.document]
  try {
    const parentWindow = currentWindow.parent
    if (parentWindow !== currentWindow && parentWindow.document !== currentWindow.document) documents.push(parentWindow.document)
  } catch {
    // Cross-origin parents are intentionally outside this renderer's authority.
  }
  return documents
}

function overlayElementIsActive(element: Element) {
  let current: Element | null = element
  while (current) {
    if (current.hasAttribute('hidden') || current.getAttribute('aria-hidden') === 'true' || current.classList.contains('is-minimized')) return false
    if (current.tagName === 'DETAILS' && !(current as HTMLDetailsElement).open) return false
    const style = current.ownerDocument.defaultView?.getComputedStyle(current)
    if (style?.display === 'none' || style?.visibility === 'hidden') return false
    current = current.parentElement
  }
  return true
}

export function documentHasChatGPTOverlayBlocker(target: Document) {
  return [...target.querySelectorAll(CHATGPT_OVERLAY_SELECTOR)].some(overlayElementIsActive)
}

export function chatGPTOverlayBlocked(currentWindow: Window) {
  return chatGPTOverlayDocuments(currentWindow).some(documentHasChatGPTOverlayBlocker)
}

export function observeChatGPTOverlayBlockers(currentWindow: Window, onBlocked: (blocked: boolean) => void) {
  const documents = chatGPTOverlayDocuments(currentWindow)
  const sync = () => onBlocked(documents.some(documentHasChatGPTOverlayBlocker))
  sync()
  const observers = documents.flatMap((target) => {
    if (!target.body) return []
    const observer = new MutationObserver(sync)
    observer.observe(target.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden', 'data-chatgpt-overlay-blocker'],
    })
    return [observer]
  })
  return () => observers.forEach((observer) => observer.disconnect())
}
