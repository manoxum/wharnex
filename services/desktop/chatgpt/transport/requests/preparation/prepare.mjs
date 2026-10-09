import { adoptSubmittedPrompt } from './adopt.mjs'

export function createPromptPreparation(context) {
  const {
    throwIfChatGPTTransportAborted,
    sanitizeChatCacheKey,
    durableWorkspaceChatID,
    authoritativeBundleFilename,
    chatgptTransportModes,
    normalizeChatGPTReasoningEffort,
    requireAutoSession,
    retryableChatGPTPrompts,
    canonicalChatGPTConversationURL,
    chatgptViews,
    shouldAttachProjectContext,
    chatGPTConversationID,
    requestPreparationTimer,
    withRequestPreparationDeadline,
    materializeChatInput,
    localChatInputBootstrap,
    preparedChatGPTDrafts,
    manualChatGPTTransport,
    path,
    touchChatGPTEntry,
    CHATGPT_URL,
    targetChatGPTComposer,
    syncChatGPTAffinityURL,
    executeChatGPTDOMScript,
    chatGPTFillComposerScript,
    pasteChatGPTFile,
    wait,
    chatInputSettleDelay,
    chatGPTAssistantTurnCount,
    armExpectedChatGPTBundle,
    submitChatGPTDraft,
    verifyChatGPTDraft,
    disarmExpectedChatGPTBundle,
    waitForSubmittedChatGPTConversation,
    persistWorkspaceChatRemoteBestEffort,
    enqueueChatAgentFollowups,
    expectedChatGPTBundles,
  } = context

  async function preparePromptForChatGPT(request, entryOverride = undefined, { pacedWorker = false } = {}) {
    const signal = entryOverride?.transportAbortSignal
    throwIfChatGPTTransportAborted(signal)
    const text = String(request?.text || '').trim()
    if (!text) throw new Error('Prepared prompt is empty')
    if (text.length > 1024 * 1024) throw new Error('Prepared prompt exceeds 1 MiB limit')
    const key = sanitizeChatCacheKey(request?.cacheKey)
    // An Orchestrator task is a Main Request without a workspace chat: it names
    // its own input archive, and a hidden Worker may submit at an unconfirmed
    // reasoning level (adr/ADR-0078, adr/ADR-0081).
    const orchestratorTask = request?.orchestratorTask === true
    const workspaceChatId = orchestratorTask ? '' : durableWorkspaceChatID(key, request?.workspaceChatId)
    const requestId = String(request?.requestId || '').trim()
    const requestedTitle = String(request?.chatTitle || '').replace(/\s+/g, ' ').trim().slice(0, 82)
    const expectedFilename = authoritativeBundleFilename(request?.expectedFilename, requestId, key)
    const manualTransport = request?.manualTransport === true || chatgptTransportModes.get(key) === 'manual'
    if (manualTransport) chatgptTransportModes.set(key, 'manual')
    const autoSubmit = !manualTransport && request?.autoSubmit === true
    const reasoningEffort = normalizeChatGPTReasoningEffort(request?.reasoningEffort)
    if (autoSubmit) await requireAutoSession(request?.sessionId, signal)
    throwIfChatGPTTransportAborted(signal)
    // Preserve an automatic delivery only in Desktop memory so a transient
    // remote-surface failure can be retried without replanning. Manual mode
    // never schedules an automatic transport retry.
    if (!manualTransport) retryableChatGPTPrompts.set(key, { request, preparedAt: Date.now() })
    const linkedConversation = canonicalChatGPTConversationURL(request?.url || '')
    if (request?.observeSubmittedOnly === true && (!autoSubmit || !linkedConversation)) throw Object.assign(new Error('Submitted-only observation requires an automatic owned conversation'), { retryTransport: false })
    const entry = entryOverride || chatgptViews.get(key)
    const currentConversationURL = linkedConversation || canonicalChatGPTConversationURL(entry?.view.webContents.getURL() || '')
    const currentSha = String(request?.contextSha256 || '').trim()
    const previousSha = String(request?.lastContextSha256 || '').trim()
    const previousURL = String(request?.lastContextChatgptUrl || '').trim()
    const requestMetadata = {
      chat_title: requestedTitle,
      chat_id: workspaceChatId || key,
      chat_hash: currentSha,
      requested_at: String(request?.requestedAt || ''),
    }
    const includeContext = shouldAttachProjectContext({ currentSha, previousSha, currentConversationId: chatGPTConversationID(currentConversationURL), previousConversationId: chatGPTConversationID(previousURL), force: request?.includeContext === true })

    // Every planner request is one logical request ZIP. It is uploaded directly
    // when it fits or wrapped into ordered multipart ZIPs when the configured
    // per-bundle limit is smaller than the logical request. Tunnels serve only
    // the paired webapp: the request never publishes to, waits for or links a
    // tunnel, so a slow or absent provider cannot delay the bundle.
    const timer = requestPreparationTimer(requestId)
    const directPrompt = text
    const bundleChatId = orchestratorTask && request?.bundleChatId ? String(request.bundleChatId) : undefined
    const input = await withRequestPreparationDeadline(signal, (bounded) => materializeChatInput(key, request?.sessionId, requestId, request?.attachments || [], request?.artifacts || [], directPrompt, includeContext, request?.projectFiles || [], requestMetadata, bounded, bundleChatId))
    throwIfChatGPTTransportAborted(signal)
    timer.phase('archive', `bytes=${input.bytes} parts=${input.uploadPaths.length}`)
    const bootstrap = localChatInputBootstrap(requestId, input.archiveName, expectedFilename, input.requestMetadata, input.multipart)
    if (manualTransport) {
      preparedChatGPTDrafts.delete(key)
      await manualChatGPTTransport.prepare(key, {
        requestId,
        files: input.uploadPaths,
        filenames: input.uploadPaths.map((file) => path.basename(file)),
        bytes: input.bytes,
        prompt: bootstrap,
      }, entry?.view?.webContents)
      if (entry) touchChatGPTEntry(entry)
      const conversationUrl = currentConversationURL || CHATGPT_URL
      console.log(`[chatgpt-manual] prepared key=${key} attachments=${input.uploadPaths.length} bytes=${input.bytes} request=${requestId}`)
      return { ok: true, cacheKey: key, attachmentCount: input.uploadPaths.length, submitted: false, expectedFilename, includedContext: includeContext, conversationUrl, manual: true }
    }
    const target = await targetChatGPTComposer(key, linkedConversation || CHATGPT_URL, linkedConversation ? request?.preferCurrentConversation === true : false, entryOverride)
    throwIfChatGPTTransportAborted(signal)
    if (typeof request?.onTargetConversation === 'function') await request.onTargetConversation(target.conversationUrl)
    target.reasoningEffort = reasoningEffort
    target.entry.reasoningEffort = reasoningEffort
    if (autoSubmit && linkedConversation) {
      const adopted = await adoptSubmittedPrompt(context, { key, target, requestId, sessionId: request?.sessionId,
        workspaceChatId, input, bootstrap, expectedFilename, originalPrompt: directPrompt, request })
      if (adopted) return adopted
      if (request?.observeSubmittedOnly === true) throw Object.assign(new Error('The exact request ZIP was not found in an owned user turn; observation was not armed'), { retryTransport: false })
    }
    if (autoSubmit) await verifyChatGPTDraft(key, target, !orchestratorTask)
    if (!linkedConversation) syncChatGPTAffinityURL(key, target.entry)
    const filled = await executeChatGPTDOMScript(key, target.entry, 'fill-composer', chatGPTFillComposerScript(bootstrap))
    throwIfChatGPTTransportAborted(signal)
    if (!filled) throw new Error('ChatGPT composer DOM could not be populated with local input bootstrap')
    timer.phase('composer')
    for (let index = 0; index < input.uploadPaths.length; index += 1) await pasteChatGPTFile(target.entry, input.uploadPaths[index], index + 1, input.uploadPaths.length, { pacedWorker })
    throwIfChatGPTTransportAborted(signal)
    timer.phase('upload')
    let conversationUrl = target.conversationUrl
    if (autoSubmit) {
      await wait(chatInputSettleDelay(input.bytes, input.uploadPaths.length))
      throwIfChatGPTTransportAborted(signal)
      const assistantBaseline = await chatGPTAssistantTurnCount(target.wc)
      throwIfChatGPTTransportAborted(signal)
      armExpectedChatGPTBundle(key, requestId, assistantBaseline, bootstrap, [], directPrompt, request?.sessionId, expectedFilename, input.requestMetadata)
      try {
        throwIfChatGPTTransportAborted(signal)
        await submitChatGPTDraft(key, target.entry, target.conversationUrl, target, { rateLimitExempt: !pacedWorker, requireReasoningEffort: !orchestratorTask })
      } catch (error) {
        disarmExpectedChatGPTBundle(key, requestId)
        throw error
      }
      conversationUrl = await waitForSubmittedChatGPTConversation(key, target.entry, target.conversationUrl)
      if (!conversationUrl) throw new Error('ChatGPT submission was confirmed without a stable conversation id')
      timer.phase('submitted')
      if (typeof request?.onSubmittedConversation === 'function') {
        try {
          const confirmedConversation = await request.onSubmittedConversation(conversationUrl)
          if (confirmedConversation) conversationUrl = canonicalChatGPTConversationURL(confirmedConversation) || conversationUrl
        } catch (error) {
          // A dispatched request without confirmed affinity must not gain retry supervision.
          disarmExpectedChatGPTBundle(key, requestId); throw error
        }
      }
      if (workspaceChatId) await persistWorkspaceChatRemoteBestEffort(workspaceChatId, conversationUrl, { remoteState: 'awaiting-response' })
      try {
        const mainRequestTask = await enqueueChatAgentFollowups(key, requestId, conversationUrl, {
          expectedFilename, assistantBaseline, recoveryBootstrap: bootstrap, originalPrompt: directPrompt,
          sessionId: request?.sessionId || '', liveTunnels: [],
          requestMetadata: input.requestMetadata,
          projectName: request?.projectName || '', projectPath: request?.projectPath || '', workspaceChatId,
        })
        const armed = expectedChatGPTBundles.get(key)
        if (armed?.requestId === requestId) armed.mainRequestTaskId = String(mainRequestTask?.task_id || '')
      } catch (error) {
        // The AWAIT_RESPONSE task is this Main Request's only durable record
        // (see enqueueChatAgentFollowups). Every retry already ran; treat the
        // whole submission as failed rather than leaving an in-memory
        // expectation with nothing behind it that survives a Desktop restart.
        disarmExpectedChatGPTBundle(key, requestId)
        console.error(`[chatgpt-supervision] submitted request ${requestId} but durable follow-up scheduling failed after retries: ${error instanceof Error ? error.message : String(error)}`)
        throw new Error(`Não foi possível registar de forma durável o pedido ${requestId}: ${error instanceof Error ? error.message : String(error)}`)
      }
      preparedChatGPTDrafts.delete(key)
    } else {
      preparedChatGPTDrafts.set(key, { preparedAt: Date.now(), attachmentCount: input.uploadPaths.length, requestId, sessionId: request?.sessionId, recoveryBootstrap: bootstrap, liveTunnels: [], originalPrompt: directPrompt, expectedFilename, projectName: request?.projectName, projectPath: request?.projectPath || '', chatTitle: requestedTitle, conversationUrl: target.conversationUrl, workspaceChatId, requestMetadata: input.requestMetadata, reasoningEffort })
    }
    touchChatGPTEntry(target.entry)
    console.log(`[chatgpt-draft] prepared key=${key} attachments=${input.uploadPaths.length} archiveEntries=${input.archiveEntryCount} userAttachments=${input.userAttachmentCount} systemArtifacts=${input.artifactCount} includeContext=${includeContext} bytes=${input.bytes} chars=${text.length} autoSubmit=${autoSubmit}`)
    // Do not clear retryableChatGPTPrompts here: observing this submit only
    // confirms transport (a conversation POST was seen), never that ChatGPT
    // actually received the composed prompt/attachment. The entry stays
    // available for a manual "Reenviar request" until the request reaches a
    // real terminal outcome (validated bundle downloaded, or explicitly
    // superseded/cancelled) — see registerChatGPTPlanDownloads and pick-bundle.
    return { ok: true, cacheKey: key, attachmentCount: input.uploadPaths.length, submitted: autoSubmit, expectedFilename, includedContext: includeContext, conversationUrl }
  }

  return { preparePromptForChatGPT }
}
