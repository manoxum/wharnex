export function createMarkdownTranslationWorker(context) {
  const {
    markdownTranslationFilename, MAX_MARKDOWN_TRANSLATION_BYTES, paceChatGPTWorkerSubmission, path, app,
    rm, mkdir, writeFile, expectedChatGPTTranslations, reconcileChatGPTThrottleForKey,
    requireOwnedChatGPTEntry, waitForChatGPTSurfaceReady, targetChatGPTComposer, CHATGPT_URL, executeChatGPTDOMScript,
    chatGPTFillComposerScript, pasteChatGPTFile, wait, chatInputSettleDelay, chatGPTAssistantTurnCount,
    submitChatGPTDraft, waitForSubmittedChatGPTConversation, MARKDOWN_TRANSLATION_TIMEOUT_MS, MARKDOWN_TRANSLATION_POLL_MS, chatGPTHumanActionScript,
    noteChatGPTRateLimitGate, setChatGPTHumanAction, chatGPTHumanActionMessage, pollWorkerExpectedDownload, chatGPTExpectedDownloadScript,
    enqueueChatAgentTask, chatAgentConversationID,
  } = context

  async function executeChatAgentMarkdownTranslation(task, entry, key, payload) {
    if (payload?.protocol !== 'wharness.translation-input/v1' || payload?.task !== 'translate_document') {
      return { status: 'failed', error: 'invalid translation worker protocol payload' }
    }
    const expectedFilename = String(payload.result_filename || '')
    if (expectedFilename !== markdownTranslationFilename(task.task_id)) {
      return { status: 'failed', error: 'translation worker payload names a foreign result artifact' }
    }
    const requestFilename = String(payload.request_filename || '')
    if (!/^whx_translation_req_cat_[a-f0-9]{20}\.zip$/.test(requestFilename)) {
      return { status: 'failed', error: 'translation worker payload names an invalid request archive' }
    }
    const bootstrap = String(payload.bootstrap || '').trim()
    if (!bootstrap) return { status: 'failed', error: 'translation worker payload has no composer bootstrap' }
    let archive
    try { archive = Buffer.from(String(payload.archive_base64 || ''), 'base64') } catch { archive = undefined }
    if (!archive?.byteLength) return { status: 'failed', error: 'translation worker payload has no request archive' }
    if (archive.byteLength > MAX_MARKDOWN_TRANSLATION_BYTES * 2) {
      return { status: 'failed', error: 'translation request archive exceeds the transport limit' }
    }

    await paceChatGPTWorkerSubmission({ translation: true })

    const filename = expectedFilename
    const dir = path.join(app.getPath('temp'), 'wharness-markdown-translations', task.task_id)
    const sourcePath = path.join(dir, requestFilename)
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await writeFile(sourcePath, archive, { mode: 0o600 })

    let resolveDownload
    let rejectDownload
    const download = new Promise((resolve, reject) => { resolveDownload = resolve; rejectDownload = reject })
    // Attach a rejection observer immediately: a Chromium download can fail in
    // the same tick in which its will-download handler is installed.
    download.catch(() => undefined)
    const expected = {
      taskId: task.task_id, key, filename, armedAt: Date.now(),
      resolve: resolveDownload, reject: rejectDownload,
    }
    expectedChatGPTTranslations.set(filename, expected)
    reconcileChatGPTThrottleForKey(key, entry)

    // See the matching comment in executeChatAgentTodoClassification: a
    // retried attempt must not reuse a page whose composer may already hold
    // the file a previous attempt attached before failing later in the flow.
    if (Number(task.attempt || 0) > 1) {
      const { wc: staleWc } = requireOwnedChatGPTEntry(key, entry)
      await paceChatGPTWorkerSubmission({ translation: true })
      staleWc.reload()
      await waitForChatGPTSurfaceReady(key, entry)
    }
    let conversationUrl = ''
    try {
      const target = await targetChatGPTComposer(key, CHATGPT_URL, false, entry)
      target.reasoningEffort = 'instant'
      const filled = await executeChatGPTDOMScript(key, target.entry, 'translation-fill-composer', chatGPTFillComposerScript(bootstrap))
      if (!filled) throw new Error('ChatGPT translation composer could not be populated')
      await pasteChatGPTFile(target.entry, sourcePath, 1, 1, { translation: true, pacedWorker: true })
      await wait(chatInputSettleDelay(archive.byteLength, 1))
      // A fresh chat's landing-page composer is a different mounted element
      // from the one the active conversation ends up with once an attachment
      // lands; the bootstrap text set on the earlier instance does not travel
      // to its replacement, so the request reached ChatGPT as a bare file with
      // no accompanying text. Re-asserting it now targets whichever composer
      // is live at this point, right before it matters for submission.
      await executeChatGPTDOMScript(key, target.entry, 'translation-refill-composer', chatGPTFillComposerScript(bootstrap))
      const assistantBaseline = await chatGPTAssistantTurnCount(target.wc)
      // 'instant' is a latency/cost preference for this background transport,
      // not a correctness requirement: live testing found the effort-cycle
      // shortcut can stop registering, and a translation delivered at whatever
      // level the account is already on beats one that never submits at all.
      await submitChatGPTDraft(key, target.entry, target.conversationUrl, target, { requireReasoningEffort: false, rateLimitExempt: true })
      conversationUrl = await waitForSubmittedChatGPTConversation(key, target.entry, target.conversationUrl)
      if (!conversationUrl) throw new Error('ChatGPT translation submission has no stable conversation id')

      const deadline = Date.now() + MARKDOWN_TRANSLATION_TIMEOUT_MS
      // See the matching comment in executeChatAgentTodoClassification: clicking
      // the download control on every poll tick fired a real duplicate download
      // per tick, and ChatGPT's own browser-side duplicate-name suffix on the
      // later ones was not recognised by this task's strict filename match.
      expected.assistantBaseline = assistantBaseline
      while (Date.now() < deadline) {
        const outcome = await Promise.race([
          download.then((value) => ({ done: true, value }), (error) => ({ done: true, error })),
          wait(MARKDOWN_TRANSLATION_POLL_MS).then(() => ({ done: false })),
        ])
        if (outcome.done) {
          if (outcome.error) throw outcome.error
          return {
            status: 'done',
            payload: {
              protocol: 'harness.translation/v1', task_id: task.task_id, filename,
              bundle_base64: outcome.value.toString('base64'),
            },
          }
        }
        const health = await executeChatGPTDOMScript(key, target.entry, 'translation-health', chatGPTHumanActionScript())
        if (noteChatGPTRateLimitGate(key, health)) {
          return { status: 'failed', error: 'ChatGPT rate-limit gate is active' }
        }
        if (health?.required === true) {
          const kind = String(health.kind || 'verification')
          setChatGPTHumanAction(key, kind, '', 'translation-worker')
          return { status: 'failed', error: chatGPTHumanActionMessage(kind) }
        }
        await pollWorkerExpectedDownload(expected,
          (script) => executeChatGPTDOMScript(key, target.entry, 'translation-download', script), chatGPTExpectedDownloadScript)
      }
      throw new Error(`ChatGPT did not provide ${filename} before the translation timeout`)
    } finally {
      if (expectedChatGPTTranslations.get(filename) === expected) { expectedChatGPTTranslations.delete(filename); reconcileChatGPTThrottleForKey(key, entry) }
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
      if (conversationUrl) {
        enqueueChatAgentTask('DELETE_TEMP_CHAT', {
          key, requestId: task.task_id, rootRequestId: task.task_id, conversationURL: conversationUrl,
          parentTaskID: task.task_id, dedupeKey: `delete-translation:${chatAgentConversationID(conversationUrl)}`,
          payload: {}, maxAttempts: 4,
        }).catch((error) => console.warn(`[markdown-translation] temporary ChatGPT cleanup scheduling failed: ${error instanceof Error ? error.message : String(error)}`))
      }
    }
  }

  return { executeChatAgentMarkdownTranslation }
}
