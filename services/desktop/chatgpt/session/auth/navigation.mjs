export function createAuthNavigation({ chatGPTNavigationDisposition, startExternalAuthentication, shell }) {
  return function routeChatGPTNavigation(entry, event, url) {
    const disposition = chatGPTNavigationDisposition(url)
    if (disposition.kind === 'trusted') return false
    // Same-origin auth redirects remain in the owned view until the provider
    // boundary requires the explicitly managed external browser.
    if (disposition.kind === 'chatgpt-auth') {
      entry.externalAuthProvider = ''
      entry.embeddedAuthActive = true
      return false
    }
    if (disposition.kind === 'external-auth') {
      if (entry.authMode === 'embedded') {
        if (disposition.provider === 'Google') {
          event?.preventDefault?.()
          entry.embeddedAuthActive = false
          entry.embeddedAuthCrossedBoundary = false
          startExternalAuthentication(entry, 'Google')
          return true
        }
        entry.externalAuthProvider = ''
        entry.embeddedAuthActive = true
        entry.embeddedAuthCrossedBoundary = true
        return false
      }
      event?.preventDefault?.()
      startExternalAuthentication(entry, disposition.provider || 'OpenAI')
      return true
    }
    event?.preventDefault?.()
    if (disposition.kind === 'external') void shell.openExternal(url)
    return true
  }
}
