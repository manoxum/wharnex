import { chatGPTShowSidebarScript, chatGPTConfirmDeleteScript } from '../chatgpt-account.mjs'

export function createAccountDelete(context) {
  const {
    sanitizeChatCacheKey,
    chatgptViews,
    requireOwnedChatGPTEntry,
    serializeChatGPTAccountOperation,
    paceChatGPTWorkerNavigation,
    requireTrustedChatGPTURL,
    sameConversationURL,
    loadOwnedChatGPTURL,
    waitForChatGPTSurfaceReady,
    ensureChatGPTLayoutViewport,
    chatGPTConversationID,
    commitChatGPTAccountControl,
    wait,
    CHATGPT_ACCOUNT_ACTION_SETTLE_MS,
    chooseChatGPTConversationAction,
    createChatGPTAffinityTracker,
    releaseChatGPTView,
    windowStateForEntry,
    chatGPTKeyForEntry,
    hideChatGPTSidebar,
  } = context

  async function deleteChatGPTConversation(cacheKey, expectedURL = '', entryOverride = undefined) {
    const key = sanitizeChatCacheKey(cacheKey)
    const entry = entryOverride || chatgptViews.get(key)
    if (!entry) return { ok: false, state: 'view-not-live' }
    requireOwnedChatGPTEntry(key, entry)
    return serializeChatGPTAccountOperation(async () => {
      entry.accountOperationActive = true
      try {
        // See the matching comment in organizeChatGPTConversation.
        await paceChatGPTWorkerNavigation()
        const target = expectedURL ? requireTrustedChatGPTURL(expectedURL) : ''
        if (target && !sameConversationURL(entry.view.webContents.getURL(), target)) await loadOwnedChatGPTURL(key, entry, target, 'delete-conversation')
        await waitForChatGPTSurfaceReady(key, entry)
        ensureChatGPTLayoutViewport(key, entry)
        const conversationId = chatGPTConversationID(entry.view.webContents.getURL())
        const shown = await commitChatGPTAccountControl(key, entry, 'show-sidebar', chatGPTShowSidebarScript())
        if (!shown.ok) return shown
        if (shown.state === 'opening') await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS * 2)
        const chosen = await chooseChatGPTConversationAction(key, entry, 'delete', conversationId)
        if (!chosen.ok) return chosen
        await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS)
        const confirmed = await commitChatGPTAccountControl(key, entry, 'confirm-delete', chatGPTConfirmDeleteScript(), { attempts: 6 })
        if (!confirmed.ok) return confirmed
        await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS * 2)
        if (entry.role === 'worker') { entry.ownerKey = ''; entry.affinity = createChatGPTAffinityTracker() }
        else releaseChatGPTView(key, windowStateForEntry(entry))
        return { ok: true, state: 'deleted' }
      } finally {
        entry.accountOperationActive = false
        if (chatGPTKeyForEntry(entry)) await hideChatGPTSidebar(key, entry).catch(() => undefined)
      }
    })
  }

  return { deleteChatGPTConversation }
}
