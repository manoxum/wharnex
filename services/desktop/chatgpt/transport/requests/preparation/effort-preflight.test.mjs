import test from 'node:test'
import assert from 'node:assert/strict'
import { createPromptPreparation } from './prepare.mjs'

test('an unknown reasoning control fails before composer fill, file selection and response arming', async () => {
  const events = []
  const error = Object.assign(new Error('effort-level-unknown'), { retryTransport: false })
  const target = { entry: {}, wc: {}, conversationUrl: '' }
  const context = {
    throwIfChatGPTTransportAborted: () => {},
    sanitizeChatCacheKey: (value) => value,
    durableWorkspaceChatID: (key) => key,
    authoritativeBundleFilename: () => 'response.zip',
    chatgptTransportModes: new Map(),
    normalizeChatGPTReasoningEffort: () => 'high',
    requireAutoSession: async () => {},
    retryableChatGPTPrompts: new Map(),
    canonicalChatGPTConversationURL: () => '',
    chatgptViews: new Map(),
    shouldAttachProjectContext: () => false,
    chatGPTConversationID: () => '',
    requestPreparationTimer: () => ({ phase: () => {} }),
    withRequestPreparationDeadline: (_signal, work) => work(),
    materializeChatInput: async () => ({ archiveName: 'input.zip', uploadPaths: ['input.zip'], bytes: 1 }),
    localChatInputBootstrap: () => 'bootstrap',
    targetChatGPTComposer: async () => target,
    verifyChatGPTDraft: async () => { events.push('preflight'); throw error },
    executeChatGPTDOMScript: async () => { events.push('fill'); return true },
    chatGPTFillComposerScript: () => 'fill',
    pasteChatGPTFile: async () => events.push('upload'),
    armExpectedChatGPTBundle: () => events.push('arm'),
  }
  const { preparePromptForChatGPT } = createPromptPreparation(context)
  await assert.rejects(preparePromptForChatGPT({ cacheKey: 'chat', sessionId: 'session', requestId: 'req', text: 'input', autoSubmit: true }), (failure) => failure === error)
  assert.deepEqual(events, ['preflight'])
})
