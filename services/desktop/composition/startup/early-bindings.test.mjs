import test from 'node:test'
import assert from 'node:assert/strict'
import { createDesktopOwnershipRuntime } from '../session/ownership/runtime.mjs'

test('Supervisor ownership receives conversation helpers and observes later comment state', () => {
  const map = () => new Map()
  let commentsPending = false
  const deps = {
    desktopWindows: map(), chatgptViews: map(), chatGPTWorkerEntries: [],
    expectedChatGPTBundles: map(), expectedChatGPTTranslations: map(),
    expectedChatGPTReleaseNotes: map(), expectedChatGPTTodoClassifications: map(),
    expectedChatGPTOrchestratorPlans: map(), pendingChatGPTComments: map(),
    chatgptTransportModes: map(), pendingChatGPTBundleDeliveries: map(),
    chatGPTTransportTails: map(), chatSupervisorStates: map(),
    preparedChatGPTDrafts: map(), retryableChatGPTPrompts: map(),
    RETRYABLE_PROMPT_TTL_MS: 100, chatAgentResidency: {},
    canonicalChatGPTConversationURL: (value) => `canonical:${value}`,
    sameConversationURL: (left, right) => left === right,
    hasPendingChatGPTComments: () => commentsPending,
    getDesiredChatAgentSupervisorSlots: () => 6,
    sanitizeOptionalChatCacheKey: (value) => value,
    sanitizeChatCacheKey: (value) => value,
    chatAgentConversationID: () => 'id',
  }
  const ownership = createDesktopOwnershipRuntime(deps)
  const entry = { affinity: { boundURL: 'one' }, view: { webContents: { isDestroyed: () => false, getURL: () => 'one' } } }
  deps.chatgptViews.set('chat-1', entry)
  deps.expectedChatGPTBundles.set('chat-1', { requestId: 'request-1' })
  assert.equal(ownership.chatGPTSupervisorOwnsExpectedResponse('chat-1', 'request-1', 'one'), true)
  deps.expectedChatGPTBundles.clear()
  assert.equal(ownership.supervisorBindingHold('chat-1', entry), '')
  commentsPending = true
  assert.equal(ownership.supervisorBindingHold('chat-1', entry), 'queued-comment')
})
