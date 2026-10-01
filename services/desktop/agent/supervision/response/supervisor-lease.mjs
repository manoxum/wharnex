export function createSupervisorResponseLease({
  hydrateExpectedChatAgentBundle, recentlyDeliveredChatGPTBundleRequestId,
  disarmExpectedChatGPTBundle, pendingChatGPTBundleDeliveries,
  CHAT_AGENT_AWAIT_PROBE_MS, chatgptTransportModes, chatGPTHumanActionMessage,
  pollExpectedChatGPTDownloadKey, AWAIT_STALL_ATTENTION_MS,
  EXPECTED_BUNDLE_TTL_MS,
}) {
  // The resident main-process poll owns the page read and bundle capture.
  // Its durable lease only decides whether structural progress remains live.
  async function superviseChatAgentResponse(task, entry, key, payload) {
    const expected = hydrateExpectedChatAgentBundle(key, task, payload)
    if (recentlyDeliveredChatGPTBundleRequestId(expected.requestId)) {
      disarmExpectedChatGPTBundle(key, expected.requestId)
      return { status: 'done' }
    }
    // Backend ingestion may still be applying a validated ZIP. Polling the
    // provider at download cadence would reclaim this task needlessly.
    if (pendingChatGPTBundleDeliveries.has(expected.requestId)) {
      return { status: 'waiting', delayMs: CHAT_AGENT_AWAIT_PROBE_MS, observation: true, error: 'a entrega do bundle validado está a concluir' }
    }
    if (chatgptTransportModes.get(key) === 'manual') return { status: 'done' }
    if (entry.humanAction?.active) {
      return { status: 'attention', error: chatGPTHumanActionMessage(String(entry.humanAction.kind || 'verification')) }
    }
    void pollExpectedChatGPTDownloadKey(key)
    const now = Date.now()
    // Progress is stamped by the resident poll on generating, completion or
    // download evidence; task age survives Desktop restarts.
    if (now - Number(expected.progressAt || now) >= AWAIT_STALL_ATTENTION_MS) {
      return {
        status: 'attention',
        error: `ChatGPT deixou de dar sinal estrutural para ${expected.filename} durante ${Math.round(AWAIT_STALL_ATTENTION_MS / 60_000)} minutos; a conversa precisa de verificação humana.`,
      }
    }
    const createdAt = Date.parse(String(task?.created_at || '')) || 0
    if (createdAt && now - createdAt >= EXPECTED_BUNDLE_TTL_MS) {
      return { status: 'attention', error: `O Wharnex aguardou ${expected.filename} durante mais de uma hora sem entrega válida.` }
    }
    return { status: 'waiting', delayMs: CHAT_AGENT_AWAIT_PROBE_MS, observation: true }
  }

  return { superviseChatAgentResponse }
}
