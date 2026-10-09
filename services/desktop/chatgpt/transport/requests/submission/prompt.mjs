import { resumeSubmittedResponse } from './response-resume.mjs'

export function createPromptSubmission(context) {
  const {
    sanitizeChatCacheKey,
    canonicalBundleFilename,
    targetChatGPTComposer,
    chatGPTAssistantTurnCount,
    expectedChatGPTBundles,
    fillBundledChatGPTComposer,
    verifyChatGPTDraft,
    wait,
    submitChatGPTDraft,
    waitForSubmittedChatGPTConversation,
    armExpectedChatGPTBundle,
    touchChatGPTEntry,
  } = context

  async function submitPromptToChatGPT(cacheKey, value, expectedURL = '', requestId = '', sessionId = '', entryOverride = undefined) {
    const text = String(value || '').trim()
    if (!text) throw new Error('Repair prompt is empty')
    if (text.length > 1024 * 1024) throw new Error('Repair prompt exceeds 1 MiB limit')

    const key = sanitizeChatCacheKey(cacheKey)
    const expectedFilename = canonicalBundleFilename(key, requestId)
    const target = await targetChatGPTComposer(key, expectedURL, false, entryOverride)
    await verifyChatGPTDraft(key, target)
    const assistantBaseline = await chatGPTAssistantTurnCount(target.wc)
    const prior = expectedChatGPTBundles.get(key)
    let requestMetadata = prior?.requestId === requestId ? prior.requestMetadata || {} : {}
    const bundled = await fillBundledChatGPTComposer(key, target.entry, sessionId, requestId, text, expectedFilename, [], requestMetadata)
    await wait(100)
    const submission = await submitChatGPTDraft(key, target.entry, target.conversationUrl, target)
    if (!submission.accepted && !submission.dispatched) throw new Error('ChatGPT prompt submission was not dispatched')
    const conversationUrl = await waitForSubmittedChatGPTConversation(key, target.entry, target.conversationUrl)
    if (!conversationUrl) throw new Error('ChatGPT submission did not produce a stable conversation id')
    requestMetadata = bundled.requestMetadata || requestMetadata
    armExpectedChatGPTBundle(key, requestId, assistantBaseline, bundled.bootstrap, [], text, sessionId, expectedFilename, requestMetadata)
    resumeSubmittedResponse(context, key, target.entry, requestId)
    touchChatGPTEntry(target.entry)
    console.log(`[chatgpt-repair] submitted key=${key} chars=${text.length} method=dom`)
    return { ok: true, cacheKey: key, expectedFilename, conversationUrl, assistantBaseline, recoveryBootstrap: bundled.bootstrap, liveTunnels: [], requestMetadata }
  }

  return { submitPromptToChatGPT }
}
