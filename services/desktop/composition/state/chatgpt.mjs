export function createChatGPTCollections() {
  return {
    chatgptViews: new Map(),
    chatGPTWorkerEntries: [],
    chatGPTAuthBrowsers: new Map(),
    internalChatGPTBrowsers: new Map(),
    preparedChatGPTDrafts: new Map(),
    retryableChatGPTPrompts: new Map(),
    pendingChatGPTComments: new Map(),
    flushingChatGPTComments: new Set(),
    recentChatGPTCommentIds: new Map(),
    recentChatGPTCommentFingerprints: new Map(),
    chatGPTActivityFingerprints: new Map(),
    expectedChatGPTBundles: new Map(),
    expectedChatGPTTranslations: new Map(),
    expectedChatGPTReleaseNotes: new Map(),
    expectedChatGPTTodoClassifications: new Map(),
    expectedChatGPTOrchestratorPlans: new Map(),
    expectedChatGPTOrchestratorExecutions: new Map(),
    // ChatGPT delivers when it finishes, not when a Wharnex lease happens to
    // be open. A planning attempt lives only eight minutes; rejecting a late
    // exact artifact made later attempts ask the provider to produce it again.
    pollingExpectedChatGPTBundles: new Set(),
    chatGPTTransportTails: new Map(),
    // A rendered file card may outlive the downloadable provider artifact.
    // A 404 from ChatGPT's download endpoint, with no will-download event,
    // marks an expired artifact so polling does not click a dead card forever.
    chatGPTExpiredArtifactConversations: new Map(),
    pendingChatGPTBundleDeliveries: new Map(),
    // A concurrent download may slip past the retry guard before will-download
    // fires. Keep a final request-id guard before delivering to the backend.
    deliveredChatGPTBundleRequestIds: new Map(),
    // Manual browsing remains live while automated DOM reads/writes are off.
    chatgptTransportModes: new Map(),
  }
}
