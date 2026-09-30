export function createTodoClassificationWorker(context) {
  const {
    todoClassificationFilename, MAX_TODO_CLASSIFICATION_BYTES, paceChatGPTWorkerSubmission, chatAgentRateLimitDelayMs, path,
    app, rm, mkdir, writeFile, expectedChatGPTTodoClassifications,
    reconcileChatGPTThrottleForKey, requireOwnedChatGPTEntry, waitForChatGPTSurfaceReady, targetChatGPTComposer, CHATGPT_URL,
    executeChatGPTDOMScript, chatGPTFillComposerScript, pasteChatGPTFile, wait, chatInputSettleDelay,
    chatGPTAssistantTurnCount, submitChatGPTDraft, waitForSubmittedChatGPTConversation, TODO_CLASSIFICATION_TIMEOUT_MS, MARKDOWN_TRANSLATION_POLL_MS,
    chatGPTHumanActionScript, noteChatGPTRateLimitGate, setChatGPTHumanAction, chatGPTHumanActionMessage, chatGPTResponseCompletionScript,
    chatGPTExpectedDownloadScript, enqueueChatAgentTask, chatAgentConversationID,
  } = context

  async function executeChatAgentTodoClassification(task, entry, key, payload) {
    if (payload?.protocol !== 'wharness.todo-classification-input/v1' || payload?.task !== 'classify_todo') {
      return { status: 'failed', error: 'invalid TODO classification worker protocol payload' }
    }
    const filename = String(payload.result_filename || '')
    if (filename !== todoClassificationFilename(task.task_id)) return { status: 'failed', error: 'TODO classification payload names a foreign result artifact' }
    const requestFilename = String(payload.request_filename || '')
    if (!/^whx_todo_classification_req_cat_[a-f0-9]{20}\.zip$/.test(requestFilename)) return { status: 'failed', error: 'TODO classification payload names an invalid request archive' }
    const bootstrap = String(payload.bootstrap || '').trim()
    if (!bootstrap) return { status: 'failed', error: 'TODO classification payload has no composer bootstrap' }
    let archive
    try { archive = Buffer.from(String(payload.archive_base64 || ''), 'base64') } catch { archive = undefined }
    if (!archive?.byteLength || archive.byteLength > MAX_TODO_CLASSIFICATION_BYTES) return { status: 'failed', error: 'TODO classification request archive is invalid' }

    await paceChatGPTWorkerSubmission()
    const rateLimitDelay = chatAgentRateLimitDelayMs()
    if (rateLimitDelay > 0) return { status: 'waiting', delayMs: rateLimitDelay, observation: true, error: 'ChatGPT rate-limit cooldown is active' }

    const dir = path.join(app.getPath('temp'), 'wharnex-todo-classifications', task.task_id)
    const sourcePath = path.join(dir, requestFilename)
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await writeFile(sourcePath, archive, { mode: 0o600 })
    let resolveDownload
    let rejectDownload
    const download = new Promise((resolve, reject) => { resolveDownload = resolve; rejectDownload = reject })
    download.catch(() => undefined)
    const expected = { taskId: task.task_id, key, filename, armedAt: Date.now(), resolve: resolveDownload, reject: rejectDownload }
    expectedChatGPTTodoClassifications.set(filename, expected)
    reconcileChatGPTThrottleForKey(key, entry)
    // A retried attempt reuses whatever page this exact function left behind
    // when an earlier attempt got past a successful upload and then failed
    // later in the flow (submission, reasoning effort, no response). ChatGPT
    // silently no-ops re-selecting a file its composer already holds, so every
    // upload attempt against that stale page "never starts" — live testing
    // against the real account reproduced this deterministically on the very
    // first retry after a confirmed upload. A hard reload guarantees the next
    // attempt begins from an empty composer instead of a stuck one.
    if (Number(task.attempt || 0) > 0) {
      const { wc: staleWc } = requireOwnedChatGPTEntry(key, entry)
      await paceChatGPTWorkerSubmission()
      staleWc.reload()
      await waitForChatGPTSurfaceReady(key, entry)
    }
    let conversationUrl = ''
    try {
      const target = await targetChatGPTComposer(key, CHATGPT_URL, false, entry)
      target.reasoningEffort = 'instant'
      const filled = await executeChatGPTDOMScript(key, target.entry, 'todo-classification-fill', chatGPTFillComposerScript(bootstrap))
      if (!filled) throw new Error('ChatGPT TODO classification composer could not be populated')
      await pasteChatGPTFile(target.entry, sourcePath, 1, 1, { pacedWorker: true })
      await wait(chatInputSettleDelay(archive.byteLength, 1))
      // See the matching comment in executeChatAgentMarkdownTranslation: the
      // landing-page composer this was filled on is not necessarily the one
      // the conversation ends up with once the attachment lands, so the
      // bootstrap text needs reasserting against whatever composer is live now.
      await executeChatGPTDOMScript(key, target.entry, 'todo-classification-refill-composer', chatGPTFillComposerScript(bootstrap))
      const assistantBaseline = await chatGPTAssistantTurnCount(target.wc)
      // See the matching comment in executeChatAgentMarkdownTranslation:
      // 'instant' is a preference here, not a precondition for submitting.
      await submitChatGPTDraft(key, target.entry, target.conversationUrl, target, { requireReasoningEffort: false, rateLimitExempt: false })
      conversationUrl = await waitForSubmittedChatGPTConversation(key, target.entry, target.conversationUrl)
      if (!conversationUrl) throw new Error('ChatGPT TODO classification submission has no stable conversation id')
      const deadline = Date.now() + TODO_CLASSIFICATION_TIMEOUT_MS
      // Clicking the download control fires a real ChatGPT download every time.
      // Re-clicking it on every poll tick while the response sits there (the
      // download can take longer than one tick to reach will-download) queued
      // dozens of real downloads for one response - each later one landing on
      // ChatGPT's own browser-side duplicate-name suffix, which this task's
      // strict exact-filename match then failed to recognise as ours, letting
      // it fall through to a native OS save dialog. One click per response is
      // enough; only try again if that click found nothing to click yet.
      let downloadTriggered = false
      while (Date.now() < deadline) {
        const outcome = await Promise.race([
          download.then((value) => ({ done: true, value }), (error) => ({ done: true, error })),
          wait(MARKDOWN_TRANSLATION_POLL_MS).then(() => ({ done: false })),
        ])
        if (outcome.done) {
          if (outcome.error) throw outcome.error
          return { status: 'done', payload: { protocol: 'harness.todo-classification/v1', task_id: task.task_id, filename, bundle_base64: outcome.value.toString('base64') } }
        }
        const health = await executeChatGPTDOMScript(key, target.entry, 'todo-classification-health', chatGPTHumanActionScript())
        if (noteChatGPTRateLimitGate(key, health)) return { status: 'waiting', delayMs: chatAgentRateLimitDelayMs(), observation: true, error: 'ChatGPT rate-limit gate is active' }
        if (health?.required === true) {
          const kind = String(health.kind || 'verification')
          setChatGPTHumanAction(key, kind, '', 'todo-classification-worker')
          return { status: 'attention', providerWide: true, error: chatGPTHumanActionMessage(kind) }
        }
        const completion = await executeChatGPTDOMScript(key, target.entry, 'todo-classification-completion', chatGPTResponseCompletionScript(assistantBaseline))
        if (!downloadTriggered && Number(completion?.assistantCount || 0) > assistantBaseline) {
          const clicked = await executeChatGPTDOMScript(key, target.entry, 'todo-classification-download', chatGPTExpectedDownloadScript(filename, assistantBaseline))
          if (clicked) downloadTriggered = true
        }
      }
      throw new Error(`ChatGPT did not provide ${filename} before the TODO classification timeout`)
    } finally {
      if (expectedChatGPTTodoClassifications.get(filename) === expected) { expectedChatGPTTodoClassifications.delete(filename); reconcileChatGPTThrottleForKey(key, entry) }
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
      if (conversationUrl) {
        enqueueChatAgentTask('DELETE_TEMP_CHAT', {
          key, requestId: task.task_id, rootRequestId: task.task_id, conversationURL: conversationUrl,
          parentTaskID: task.task_id, dedupeKey: `delete-todo-classification:${chatAgentConversationID(conversationUrl)}`, payload: {}, maxAttempts: 4,
        }).catch((error) => console.warn(`[todo-classification] temporary ChatGPT cleanup scheduling failed: ${error instanceof Error ? error.message : String(error)}`))
      }
    }
  }

  return { executeChatAgentTodoClassification }
}
