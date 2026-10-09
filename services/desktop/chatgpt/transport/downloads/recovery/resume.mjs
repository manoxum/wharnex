import { restoredContinuationCount } from '../../../../agent/scheduling/queue/index.mjs'

export function registerResumeExpectedBundleIPC({
  ipcMain, trustedSender, sanitizeChatCacheKey, requireTrustedChatGPTURL,
  canonicalChatGPTConversationURL, authoritativeBundleFilename,
  getChatAgentScheduler, classifyChatGPTRequestDelivery,
  ensureChatGPTView, requireOwnedChatGPTEntry,
  withChatGPTTransportPreparation, targetChatGPTComposer,
  waitForChatGPTSurfaceReady, executeChatGPTDOMScript,
  chatGPTSubmittedRequestEvidenceScript, chatInputArchiveFilename,
  disarmExpectedChatGPTBundle, refreshChatAgentRuntimeState,
  publishChatAgentRuntimeState, armExpectedChatGPTBundle,
  expectedChatGPTBundles, chatAgentInitialRequestWaitMs,
  durableWorkspaceChatID, persistWorkspaceChatRemoteBestEffort,
  expectedChatAgentPayload, enqueueChatAgentTask,
}) {
  ipcMain.handle('wharness:chatgpt:resume-expected-bundle', async (event, request) => {
    const windowState = trustedSender(event)
    const key = sanitizeChatCacheKey(request?.cacheKey)
    const requestId = String(request?.requestId || '').trim()
    const target = requireTrustedChatGPTURL(request?.url || '')
    const conversation = canonicalChatGPTConversationURL(target)
    if (!conversation) throw new Error('Pending bundle recovery requires a concrete trusted ChatGPT conversation URL')
    const recoveryPrompt = String(request?.recoveryBootstrap || '')
    const expectedFilename = authoritativeBundleFilename(request?.expectedFilename, requestId, key)
    const requestMetadata = {
      chat_title: String(request?.chatTitle || ''), chat_id: key,
      chat_hash: String(request?.chatHash || ''), requested_at: String(request?.requestedAt || ''),
    }
    const chatAgentScheduler = getChatAgentScheduler()
    if (!chatAgentScheduler) throw new Error('ChatGPT task scheduler is not ready')
    const listed = await chatAgentScheduler.list({ request_id: requestId })
    const delivery = classifyChatGPTRequestDelivery(listed?.tasks, key)
    if (delivery === 'writing') {
      return { ok: false, cacheKey: key, requestId, expectedFilename, reason: 'write_in_progress' }
    }
    if (delivery === 'not_submitted') {
      return { ok: false, cacheKey: key, requestId, expectedFilename, reason: 'write_not_submitted' }
    }
    const { entry } = ensureChatGPTView(key, windowState)
    requireOwnedChatGPTEntry(key, entry)
    return withChatGPTTransportPreparation(key, entry, requestId, async () => {
      const targeted = await targetChatGPTComposer(key, conversation, false, entry)
      if (entry.loading || targeted.wc.isLoading()) await waitForChatGPTSurfaceReady(key, entry)
      const submissionEvidence = await executeChatGPTDOMScript(
        key,
        entry,
        'resume-original-request',
        chatGPTSubmittedRequestEvidenceScript(chatInputArchiveFilename(key, requestId)),
      )
      if (submissionEvidence?.submitted !== true) {
        const latest = await chatAgentScheduler.list({ request_id: requestId })
        const currentDelivery = classifyChatGPTRequestDelivery(latest?.tasks, key)
        if (currentDelivery === 'writing' || currentDelivery === 'submitted') {
          return { ok: false, cacheKey: key, requestId, expectedFilename, reason: 'write_in_progress' }
        }
        disarmExpectedChatGPTBundle(key, requestId)
        void refreshChatAgentRuntimeState().then(publishChatAgentRuntimeState).catch(() => undefined)
        return { ok: false, cacheKey: key, requestId, expectedFilename, reason: 'resend_required' }
      }
      const prior = expectedChatGPTBundles.get(key)
      const recoveryCount = await restoredContinuationCount(chatAgentScheduler, listed?.tasks, key, requestId,
        prior?.requestId === requestId ? prior : undefined)
      armExpectedChatGPTBundle(key, requestId, 0, recoveryPrompt, [], recoveryPrompt, request?.sessionId, expectedFilename, requestMetadata)
      const resumedExpected = expectedChatGPTBundles.get(key)
      if (resumedExpected) {
        resumedExpected.rehydrating = true
        resumedExpected.continuationCount = Math.max(recoveryCount, Number(resumedExpected.continuationCount || 0))
        resumedExpected.automaticContinuationSent ||= resumedExpected.continuationCount > 0
        resumedExpected.recoveryEligibleAt = Date.now() + chatAgentInitialRequestWaitMs()
      }
      const workspaceChatId = durableWorkspaceChatID(key, request?.workspaceChatId)
      if (workspaceChatId) await persistWorkspaceChatRemoteBestEffort(workspaceChatId, conversation, { remoteState: 'awaiting-response' })
      const payload = expectedChatAgentPayload(key, requestId, conversation, {
        expectedFilename, recoveryBootstrap: recoveryPrompt, originalPrompt: recoveryPrompt,
        sessionId: request?.sessionId, workspaceChatId, requestMetadata,
        recoveryCount: resumedExpected?.continuationCount ?? recoveryCount, observationOnly: true,
      })
      const successor = await enqueueChatAgentTask('AWAIT_RESPONSE', {
        key, requestId, rootRequestId: requestId, conversationURL: conversation,
        sessionID: payload.session_id, dedupeKey: `await:${requestId}`,
        payload, maxAttempts: 30,
      })
      if (resumedExpected?.requestId === requestId && successor?.task_id) {
        resumedExpected.mainRequestTaskId = String(successor.task_id)
      }
      return { ok: true, cacheKey: key, requestId, expectedFilename, scheduled: true }
    })
  })
}
