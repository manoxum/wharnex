export function createChatGPTConversationURLs(requireTrustedURL) {
  function conversationID(value) {
    try {
      const trusted = requireTrustedURL(value)
      // Project conversations live under /g/g-p-<project>/c/<id>.
      const { pathname } = new URL(trusted)
      const id = /(?:^|\/)c\/([^/?#]+)/.exec(pathname)?.[1] || ''
      // Provisional creation URLs cannot become durable bindings.
      return /^[A-Za-z0-9-]{1,128}$/.test(id) ? id : ''
    } catch { return '' }
  }

  function canonicalURL(value) {
    const id = conversationID(value)
    return id ? `https://chatgpt.com/c/${id}` : ''
  }

  function sameConversation(left, right) {
    const a = conversationID(left)
    const b = conversationID(right)
    return Boolean(a && b && a === b)
  }

  return { conversationID, canonicalURL, sameConversation }
}
