export function createChatGPTHumanAttention({
  chatgptViews, expectedChatGPTBundles, retryableChatGPTPrompts,
  windowStateForEntry, sendToChatGPTKey, sendToWindowState,
  Notification, recordChatGPTTaskEvent,
}) {
  function chatGPTHumanActionMessage(kind, detail = '') {
    const suffix = String(detail || '').trim()
    if (kind === 'verification') return 'O ChatGPT exige uma verificação humana/anti-robô. Abra o separador ChatGPT e conclua a verificação; a recuperação automática ficou pausada para não reiniciar o desafio.'
    if (kind === 'authentication') return 'A sessão do ChatGPT precisa de autenticação humana. Abra o separador ChatGPT e conclua o login para o Wharnex retomar o pedido.'
    if (kind === 'access') return 'O ChatGPT bloqueou o acesso ao pedido. Abra o separador ChatGPT e conclua qualquer verificação apresentada antes de continuar.'
    if (kind === 'surface') return 'A interface do ChatGPT deixou de expor o compositor mesmo após uma recarga de recuperação. Abra o separador ChatGPT e confirme se existe um aviso, bloqueio ou alteração de interface.'
    if (kind === 'transport') return `A ligação ao ChatGPT continuou a falhar após as tentativas automáticas${suffix ? ` (${suffix})` : ''}. Verifique a ligação/VPN/proxy e abra o ChatGPT antes de continuar.`
    if (kind === 'stalled') return 'O pedido do ChatGPT continuou sem progresso após a recarga e a única continuação automática permitida. Abra o separador ChatGPT e conclua/retome o pedido manualmente.'
    return 'O ChatGPT requer uma ação humana antes de o Wharnex poder continuar.'
  }

  function setChatGPTHumanAction(cacheKey, kind, detail = '', source = 'dom') {
    const entry = chatgptViews.get(cacheKey)
    if (!entry) return false
    const expected = expectedChatGPTBundles.get(cacheKey)
    const requestId = expected?.requestId || entry.transportRequestId || retryableChatGPTPrompts.get(cacheKey)?.request?.requestId || ''
    const message = chatGPTHumanActionMessage(kind, detail)
    const fingerprint = `${kind}:${requestId}:${String(detail || '').slice(0, 160)}`
    if (entry.humanAction?.active && entry.humanNoticeFingerprint === fingerprint) return false
    entry.humanAction = { active: true, kind, source, requestId, message, detectedAt: new Date().toISOString() }
    entry.humanNoticeFingerprint = fingerprint
    const payload = { cacheKey, ...entry.humanAction }
    sendToChatGPTKey(cacheKey, 'wharness:chatgpt:human-action', payload)
    const state = windowStateForEntry(entry)
    if (state?.window && !state.window.isDestroyed()) {
      state.window.flashFrame(true)
      if (Notification.isSupported()) {
        try {
          const notification = new Notification({ title: 'Ação necessária no ChatGPT', body: message, silent: false })
          notification.on('click', () => {
            if (state.window.isDestroyed()) return
            state.window.show(); state.window.focus()
            sendToWindowState(state, 'wharness:chatgpt:human-action', { ...payload, open: true })
          })
          notification.show()
        } catch (error) { console.warn('[chatgpt-human-action] notification failed', error) }
      }
    }
    console.warn(`[chatgpt-human-action] key=${cacheKey} request=${requestId || '-'} kind=${kind} source=${source}`)
    // This one durable event covers every human escalation caller.
    if (expected) recordChatGPTTaskEvent(expected, 'chatgpt.human_action_required', { kind, source, detail: String(detail || '').slice(0, 500) })
    return true
  }

  function clearChatGPTHumanAction(cacheKey, reason = '') {
    const entry = chatgptViews.get(cacheKey)
    if (!entry?.humanAction?.active) return false
    const prior = entry.humanAction
    entry.humanAction = undefined
    entry.humanNoticeFingerprint = ''
    const state = windowStateForEntry(entry)
    if (state?.window && !state.window.isDestroyed() && state.window.isFocused()) state.window.flashFrame(false)
    sendToChatGPTKey(cacheKey, 'wharness:chatgpt:human-action', {
      cacheKey,
      active: false,
      kind: prior.kind,
      source: prior.source,
      requestId: prior.requestId,
      message: reason ? `Controlo do ChatGPT restabelecido: ${reason}.` : 'Controlo do ChatGPT restabelecido.',
      detectedAt: new Date().toISOString(),
    })
    return true
  }

  return { chatGPTHumanActionMessage, setChatGPTHumanAction, clearChatGPTHumanAction }
}
