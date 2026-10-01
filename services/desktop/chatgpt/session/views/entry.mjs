export function createChatGPTViewEntry(view, ownerKey, ownerWindowId, createChatGPTAffinityTracker, extra = {}) {
  return {
    ownerKey, ownerWindowId, view, loading: false,
    lastUsed: Date.now(), lastNetworkActivity: Date.now(), lastConversationActivity: Date.now(),
    conversationRequests: new Map(), staleConversationRequestIds: new Set(),
    conversationTransportGeneration: 0, transportPreparationCount: 0, transportRequestId: '',
    healthProbeFailures: 0, loadingSince: 0, loadingFaultNoted: false,
    humanAction: undefined, humanNoticeFingerprint: '', lastSurfaceFingerprint: '',
    externalAuthProvider: '', authMode: 'embedded', embeddedAuthActive: false,
    embeddedAuthCrossedBoundary: false, authenticated: false, authProbeTimer: undefined,
    affinitySettleTimer: undefined, navigationPromise: undefined, navigationTarget: '',
    parkedLayout: true, layoutViewportGranted: true,
    affinity: createChatGPTAffinityTracker(),
    ...extra,
  }
}

export function advanceChatGPTConversationTransportGeneration(entry, {
  classifyChatGPTConversationTransport, reconcileChatGPTConversationTransport,
}) {
  entry.conversationTransportGeneration = Number(entry.conversationTransportGeneration || 0) + 1
  const classification = classifyChatGPTConversationTransport(entry.conversationRequests, {
    generation: entry.conversationTransportGeneration,
  })
  reconcileChatGPTConversationTransport(entry.conversationRequests, classification)
  entry.staleConversationRequestIds.clear()
}
