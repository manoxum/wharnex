export function createSupervisorOwnership({
  chatgptViews, chatgptTransportModes, expectedChatGPTBundles,
  canonicalChatGPTConversationURL, sameConversationURL,
  pendingChatGPTBundleDeliveries, hasPendingChatGPTComments,
  chatGPTTransportTails, chatSupervisorStates,
  preparedChatGPTDrafts, retryableChatGPTPrompts,
  RETRYABLE_PROMPT_TTL_MS, getDesiredChatAgentSupervisorSlots,
  sanitizeOptionalChatCacheKey, chatAgentConversationID,
}) {
  // Whether the Supervisor bound to this chat owns its response supervision.
  //
  // Ownership used to require the slot to be the visible one, because only two
  // slots existed and a hidden one was a warm standby for the next chat. With a
  // Supervisor per chat the relationship is inverted: the slot that sent the
  // request stays on that conversation until its bundle arrives, visible or not,
  // and the main-process poll reads it there. That is what removes the navigation
  // a Worker would otherwise make to a page that is already loaded — the provider
  // request that earned the account its 429s.
  //
  // Manual transport and an in-flight external login are excluded: in both cases
  // no automated supervision may run on the surface, so claiming ownership would
  // silence the lane for everybody.
  function chatGPTSupervisorOwnsExpectedResponse(key, requestId = '', conversationURL = '') {
    const entry = chatgptViews.get(key)
    if (!entry || entry.view.webContents.isDestroyed()) return false
    if (entry.externalAuthProvider || chatgptTransportModes.get(key) === 'manual') return false
    const expected = expectedChatGPTBundles.get(key)
    if (!expected || (requestId && expected.requestId !== String(requestId))) return false
    const currentURL = canonicalChatGPTConversationURL(entry.affinity.boundURL || entry.view.webContents.getURL())
    const expectedURL = canonicalChatGPTConversationURL(conversationURL)
    return Boolean(currentURL && (!expectedURL || sameConversationURL(currentURL, expectedURL)))
  }

  // Why this Supervisor slot may not give its chat up yet.
  //
  // A Supervisor unbinds only once it has nothing left to finish: the request
  // completed and a valid bundle was collected and handed over. Anything still in
  // flight — an armed expectation, a settling delivery, a queued comment, an open
  // transport or account operation, a pending human action, a live Supervisor
  // lease — is work that dies with the renderer, and re-doing it costs exactly the
  // provider requests this topology exists to avoid.
  function supervisorBindingHold(key, entry) {
    if (!entry) return ''
    const expected = expectedChatGPTBundles.get(key)
    if (expected) {
      if (pendingChatGPTBundleDeliveries.has(expected.requestId)) return 'bundle-delivery'
      return 'expected-bundle'
    }
    if (hasPendingChatGPTComments(key)) return 'queued-comment'
    if (chatGPTTransportTails.has(`chat:${key}`)) return 'transport'
    if (Number(entry.transportPreparationCount || 0) > 0) return 'transport'
    if (entry.accountOperationActive) return 'account-operation'
    if (entry.humanAction?.active) return 'human-action'
    if (entry.externalAuthProvider) return 'external-auth'
    if (chatSupervisorLeaseKeys().has(key)) return 'supervisor-lease'
    // A draft or retry affordance the human may still act on. Both are swept only
    // when something touches that chat again, so the hold has to expire on its own
    // recorded age — an abandoned draft must not pin a renderer for the life of
    // the process while other chats queue for a slot.
    const drafted = Math.max(
      Number(preparedChatGPTDrafts.get(key)?.preparedAt || 0),
      Number(retryableChatGPTPrompts.get(key)?.preparedAt || 0))
    if (drafted && Date.now() - drafted < RETRYABLE_PROMPT_TTL_MS) return 'prepared-prompt'
    return ''
  }

  function supervisorBindingHeld(key, entry) {
    return supervisorBindingHold(key, entry) !== ''
  }

  function chatSupervisorSlotID(index) {
    return `supervisor-${Math.max(1, Math.min(getDesiredChatAgentSupervisorSlots(), Number(index) || 1))}`
  }

  function supervisorEntryForSlot(slotID) {
    const id = String(slotID || '')
    if (!id) return undefined
    for (const entry of chatgptViews.values()) if (entry.slotId === id) return entry
    return undefined
  }

  function supervisorKeyForSlot(slotID) {
    const id = String(slotID || '')
    if (!id) return ''
    for (const [key, entry] of chatgptViews) if (entry.slotId === id) return key
    return ''
  }

  // Chats a Supervisor currently holds a durable lease for. A leased task is work
  // in progress by definition, so its chat cannot be handed to another slot.
  function chatSupervisorLeaseKeys() {
    const keys = new Set()
    for (const runtime of chatSupervisorStates.values()) {
      const key = sanitizeOptionalChatCacheKey(runtime?.task?.chat_id)
      if (key) keys.add(key)
    }
    return keys
  }

  // Lanes every bound Supervisor is responsible for, whatever the task.
  //
  // Workers are barred from these lanes as defence in depth: the durable claim
  // already partitions task types by pool, but a Worker arriving on a conversation
  // a Supervisor is resident on is a second navigation of a loaded page even when
  // the task itself is legitimate small work.
  function chatSupervisorBoundLanes() {
    const lanes = new Set()
    for (const [key, entry] of chatgptViews) {
      if (!supervisorBindingHeld(key, entry)) continue
      lanes.add(`h:${key}`)
      const conversationID = chatAgentConversationID(entry.affinity.boundURL || entry.view.webContents.getURL())
      if (conversationID) lanes.add(`c:${conversationID}`)
    }
    return lanes
  }
  return { chatGPTSupervisorOwnsExpectedResponse, supervisorBindingHold, supervisorBindingHeld, chatSupervisorSlotID, supervisorEntryForSlot, supervisorKeyForSlot, chatSupervisorLeaseKeys, chatSupervisorBoundLanes }
}
