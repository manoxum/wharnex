export const CHATGPT_OVERLAY_SELECTOR = '[aria-modal="true"], [data-chatgpt-overlay-blocker="true"]'

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
