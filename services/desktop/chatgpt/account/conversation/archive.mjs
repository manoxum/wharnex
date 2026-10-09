import { chatGPTStopConversationScript, chatGPTShowSidebarScript } from '../scripts/index.mjs'

export function createAccountArchive(context) {
  const {
    sanitizeChatCacheKey,
    chatgptViews,
    requireOwnedChatGPTEntry,
    serializeChatGPTAccountOperation,
    reconcileChatGPTThrottle,
    paceChatGPTWorkerNavigation,
    requireTrustedChatGPTURL,
    sameConversationURL,
    loadOwnedChatGPTURL,
    waitForChatGPTSurfaceReady,
    ensureChatGPTLayoutViewport,
    chatGPTConversationID,
    runChatGPTAccountAction,
    commitChatGPTAccountControl,
    wait,
    CHATGPT_ACCOUNT_ACTION_SETTLE_MS,
    chooseChatGPTConversationAction,
    createChatGPTAffinityTracker,
    releaseChatGPTView,
    windowStateForEntry,
    hideChatGPTSidebar,
  } = context

  async function archiveChatGPTConversation(cacheKey, expectedURL = '', entryOverride = undefined) {
    const key = sanitizeChatCacheKey(cacheKey)
    // A released view plus a known conversation URL is the normal shape of the
    // deferred retry: the chat was already archived locally and its renderer torn
    // down. Recreating the owned view is the only way to actually reach the
    // conversation, and reporting "view-not-live" as success would silently
    // retire a remote archive that never happened.
    // Only an already-resident surface is driven here. Creating a view purely to
    // serve a deferred retry meant a create/navigate/destroy cycle on the shared
    // sandboxed partition, and rapidly cycling sandboxed renderers is what
    // triggers Electron's "Cannot destructure property 'preloadScripts' of
    // 'binding.startupData'" crash, which takes the whole frontend down with it.
    // A retry that finds no live surface stays pending for the next attempt.
    const entry = entryOverride || chatgptViews.get(key)
    if (!entry) return { ok: false, state: 'view-not-live' }
    requireOwnedChatGPTEntry(key, entry)
    return serializeChatGPTAccountOperation(async () => {
      entry.accountOperationActive = true
      reconcileChatGPTThrottle(key, entry)
      try {
        // See the matching comment in organizeChatGPTConversation: account-
        // lifecycle actions are provider-facing navigation and must share the
        // same process-wide gate a submission does.
        await paceChatGPTWorkerNavigation()
        const target = expectedURL ? requireTrustedChatGPTURL(expectedURL) : ''
        if (target && !sameConversationURL(entry.view.webContents.getURL(), target)) await loadOwnedChatGPTURL(key, entry, target, 'archive-conversation')
        await waitForChatGPTSurfaceReady(key, entry)
        ensureChatGPTLayoutViewport(key, entry)
        const conversationId = chatGPTConversationID(entry.view.webContents.getURL())
        const stopped = await runChatGPTAccountAction('stop-conversation', { key }, () => commitChatGPTAccountControl(key, entry, 'stop', chatGPTStopConversationScript()))
        if (stopped.state === 'stopping') await wait(750)
        // The archive control lives in the sidebar history row's own menu, so the
        // sidebar has to be open before the conversation's trigger exists.
        const shown = await commitChatGPTAccountControl(key, entry, 'show-sidebar', chatGPTShowSidebarScript())
        if (shown.state === 'opening') await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS * 2)
        const archived = await chooseChatGPTConversationAction(key, entry, 'archive', conversationId)
        if (archived.ok && entry.role === 'worker') { entry.ownerKey = ''; entry.affinity = createChatGPTAffinityTracker() }
        else if (archived.ok) releaseChatGPTView(key, windowStateForEntry(entry))
        else await hideChatGPTSidebar(key, entry).catch(() => undefined)
        return archived
      } finally {
        entry.accountOperationActive = false
        if (chatgptViews.get(key) === entry) reconcileChatGPTThrottle(key, entry)
      }
    })
  }

  return { archiveChatGPTConversation }
}
