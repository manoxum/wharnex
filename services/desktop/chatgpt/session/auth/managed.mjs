import { relayManagedBrowserCookies } from './relay.mjs'

export function createManagedAuthentication({
  chatGPTAuthBrowsers, chatGPTKeyForEntry, managedAuthProfilePath,
  closeManagedBrowserAuth, launchManagedBrowserAuth, electronCookieDetails,
  session, partition, loginURL, homeURL, isTrustedChatGPTOrigin, isChatGPTAuthURL,
  loadOwnedChatGPTURL, windowStateForEntry, chatGPTSurfaceShouldBeVisible,
  publishChatGPTState, publishAuthComplete, publishAuthError, publishExternalAuth,
  sanitizeDiagnosticURL,
}) {
  async function cleanup(cacheKey, record) {
    if (chatGPTAuthBrowsers.get(cacheKey) === record) chatGPTAuthBrowsers.delete(cacheKey)
    await closeManagedBrowserAuth(record)
  }

  async function fail(cacheKey, entry, record, error) {
    if (record.cancelled) return
    record.cancelled = true
    entry.externalAuthProvider = ''
    await cleanup(cacheKey, record)
    const ownerState = windowStateForEntry(entry)
    if (ownerState?.activeChatGPTKey === cacheKey) entry.view.setVisible(chatGPTSurfaceShouldBeVisible(entry, ownerState))
    publishChatGPTState(cacheKey)
    const message = error instanceof Error ? error.message : String(error)
    publishAuthError(cacheKey, record.provider, message)
    console.error('[chatgpt-auth] external failed key=' + cacheKey + ' provider=' + record.provider + ' reason=' + (error instanceof Error ? error.name : 'unknown'))
  }

  async function complete(cacheKey, entry, record, result) {
    if (record.completed || record.cancelled) return
    record.completed = true
    try {
      const imported = await relayManagedBrowserCookies({
        cookies: result.cookies, session, partition, electronCookieDetails,
      })
      entry.externalAuthProvider = ''
      entry.authenticated = true
      const embedded = entry.view.webContents
      if (!embedded.isDestroyed()) {
        const current = embedded.getURL()
        const target = isTrustedChatGPTOrigin(current) && !isChatGPTAuthURL(current) ? current : homeURL
        await loadOwnedChatGPTURL(cacheKey, entry, target, 'external-auth-complete')
      }
      await cleanup(cacheKey, record)
      const ownerState = windowStateForEntry(entry)
      if (ownerState?.activeChatGPTKey === cacheKey) entry.view.setVisible(chatGPTSurfaceShouldBeVisible(entry, ownerState))
      publishChatGPTState(cacheKey)
      publishAuthComplete(cacheKey, 'external', result.callbackURL)
      console.log('[chatgpt-auth] external callback completed key=' + cacheKey + ' cookies=' + imported + ' url=' + sanitizeDiagnosticURL(result.callbackURL))
    } catch (error) {
      await fail(cacheKey, entry, record, error)
    }
  }

  function cancelExternalAuthentication(cacheKey) {
    const record = chatGPTAuthBrowsers.get(cacheKey)
    if (!record) return
    record.cancelled = true
    chatGPTAuthBrowsers.delete(cacheKey)
    void closeManagedBrowserAuth(record)
  }

  function startExternalAuthentication(entry, provider = 'OpenAI') {
    const cacheKey = chatGPTKeyForEntry(entry)
    if (!cacheKey) throw new Error('ChatGPT view is not registered')
    entry.authMode = 'external'
    const existing = chatGPTAuthBrowsers.get(cacheKey)
    if (existing && !existing.cancelled && !existing.completed) {
      publishExternalAuth(entry, provider, loginURL)
      return { ok: true, cacheKey, reused: true }
    }
    const profileDir = managedAuthProfilePath()
    const activeRecord = [...chatGPTAuthBrowsers.entries()].find(([key, candidate]) => key !== cacheKey && !candidate.cancelled && !candidate.completed)
    if (activeRecord) throw new Error('Já existe uma autenticação externa em curso. Conclua ou cancele essa janela antes de iniciar outra.')
    const record = { completed: false, cancelled: false, provider, profileDir, port: 0, child: undefined }
    chatGPTAuthBrowsers.set(cacheKey, record)
    publishExternalAuth(entry, provider, loginURL)
    console.log('[chatgpt-auth] starting managed browser key=' + cacheKey + ' provider=' + provider + ' profile=persistent')
    void launchManagedBrowserAuth({
      profileDir,
      loginURL,
      onReady: ({ port, child }) => {
        record.port = port
        record.child = child
        if (record.cancelled) void closeManagedBrowserAuth(record)
        publishChatGPTState(cacheKey)
      },
    }).then((result) => {
      record.port = result.port
      record.child = result.child
      if (record.cancelled) {
        void closeManagedBrowserAuth(record)
        return
      }
      void complete(cacheKey, entry, record, result)
    }).catch((error) => {
      if (record.cancelled) {
        void closeManagedBrowserAuth(record)
        return
      }
      void fail(cacheKey, entry, record, error)
    })
    return { ok: true, cacheKey, reused: false }
  }

  return { cancelExternalAuthentication, startExternalAuthentication }
}
