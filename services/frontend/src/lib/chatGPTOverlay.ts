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

export function observeChatGPTOverlayBlockers(currentWindow: Window, onBlocked: (blocked: boolean) => void) {
  const documents = chatGPTOverlayDocuments(currentWindow)
  const sync = () => onBlocked(documents.some((target) => Boolean(target.querySelector(CHATGPT_OVERLAY_SELECTOR))))
  sync()
  const observers = documents.flatMap((target) => {
    if (!target.body) return []
    const observer = new MutationObserver(sync)
    observer.observe(target.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-hidden', 'data-chatgpt-overlay-blocker'],
    })
    return [observer]
  })
  return () => observers.forEach((observer) => observer.disconnect())
}
