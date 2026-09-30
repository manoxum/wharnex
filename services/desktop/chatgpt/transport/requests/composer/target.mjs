export function createChatGPTComposerTarget({
  sanitizeChatCacheKey, ensureChatGPTView, requireOwnedChatGPTEntry,
  ensureChatGPTLayoutViewport, requireTrustedChatGPTURL,
  canonicalChatGPTConversationURL, syncChatGPTAffinityURL,
  sameConversationURL, loadOwnedChatGPTURL, proposeCurrentChatGPTAffinity,
  waitForChatGPTSurfaceReady, executeChatGPTDOMScript,
  chatGPTHumanActionScript, noteChatGPTRateLimitGate,
  setChatGPTHumanAction, clearChatGPTHumanAction,
  chatGPTHumanActionMessage, chatGPTComposerReadyScript,
  touchChatGPTEntry, wait,
}) {
  async function targetChatGPTComposer(cacheKey, expectedURL = '', preferCurrentConversation = false, entryOverride = undefined) {
    const key = sanitizeChatCacheKey(cacheKey)
    const entry = entryOverride || ensureChatGPTView(key).entry
    const { wc } = requireOwnedChatGPTEntry(key, entry)
    // Trusted native input needs a real viewport even on hidden owned views.
    ensureChatGPTLayoutViewport(key, entry)
    if (entry.externalAuthProvider) throw new Error(`ChatGPT está em autenticação externa via ${entry.externalAuthProvider}. Use o navegador do sistema e importe o bundle ZIP pelo Wharnex.`)
    if (expectedURL) {
      const target = requireTrustedChatGPTURL(expectedURL)
      const linkedConversation = canonicalChatGPTConversationURL(target)
      if (linkedConversation && entry.affinity.boundURL !== linkedConversation && entry.affinity.phase !== 'candidate') syncChatGPTAffinityURL(key, entry, linkedConversation)
      const currentConversation = canonicalChatGPTConversationURL(wc.getURL())
      const keepCurrent = !linkedConversation && preferCurrentConversation && Boolean(currentConversation)
      if (!sameConversationURL(wc.getURL(), target) && !keepCurrent) await loadOwnedChatGPTURL(key, entry, target, 'composer-target')
      else if (keepCurrent) proposeCurrentChatGPTAffinity(key, entry, linkedConversation, currentConversation)
    }
    await waitForChatGPTSurfaceReady(key, entry)
    const assertNoHumanGate = async (stage) => {
      const health = await executeChatGPTDOMScript(key, entry, stage, chatGPTHumanActionScript())
      if (noteChatGPTRateLimitGate(key, health)) {
        throw new Error('O ChatGPT bloqueou a conta por excesso de pedidos; o envio fica suspenso até o limite expirar.')
      }
      if (health?.required === true) {
        const kind = String(health.kind || 'verification')
        setChatGPTHumanAction(key, kind, '', 'dom')
        throw new Error(chatGPTHumanActionMessage(kind))
      }
      if (entry.humanAction?.source === 'dom' && health?.composerReady === true) clearChatGPTHumanAction(key, 'interface disponível')
    }
    const composerReady = async () => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const ready = await executeChatGPTDOMScript(key, entry, 'composer-ready', chatGPTComposerReadyScript())
        if (ready) return true
        await wait(250)
      }
      return false
    }
    await assertNoHumanGate('health')
    let ready = await composerReady()
    if (!ready) {
      console.warn(`[chatgpt-composer] unavailable key=${key}; reloading once before human escalation`)
      wc.reload()
      await waitForChatGPTSurfaceReady(key, entry)
      await assertNoHumanGate('health-after-composer-reload')
      ready = await composerReady()
    }
    if (!ready) {
      setChatGPTHumanAction(key, 'surface', 'composer DOM was not found after bounded recovery reload', 'dom')
      throw new Error(chatGPTHumanActionMessage('surface'))
    }
    touchChatGPTEntry(entry)
    return { key, entry, wc, conversationUrl: canonicalChatGPTConversationURL(wc.getURL()) }
  }

  return { targetChatGPTComposer }
}
