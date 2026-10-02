export function createUITestingDiscoveryWorker(context) {
  const {
    uiTestingDiscoveryFilename, MAX_UI_TEST_DISCOVERY_REQUEST_BYTES,
    UI_TEST_DISCOVERY_TIMEOUT_MS, MARKDOWN_TRANSLATION_POLL_MS,
    paceChatGPTWorkerSubmission, chatAgentRateLimitDelayMs, path, app, rm, mkdir, writeFile,
    expectedChatGPTUITestDiscoveries, reconcileChatGPTThrottleForKey,
    requireOwnedChatGPTEntry, waitForChatGPTSurfaceReady, targetChatGPTComposer, CHATGPT_URL,
    executeChatGPTDOMScript, chatGPTFillComposerScript, pasteChatGPTFile, wait,
    chatInputSettleDelay, chatGPTAssistantTurnCount, submitChatGPTDraft,
    waitForSubmittedChatGPTConversation, chatGPTHumanActionScript, noteChatGPTRateLimitGate,
    setChatGPTHumanAction, chatGPTHumanActionMessage, pollWorkerExpectedDownload,
    chatGPTExpectedDownloadScript, enqueueChatAgentTask, chatAgentConversationID, post,
  } = context

  async function discover(task, entry, key, payload) {
    const request = payload?.request || {}
    if (payload?.protocol !== 'wharnex.ui-test-discovery-input/v1' || request?.task !== 'discover_ui_tests') {
      return { status:'failed', error:'invalid UI discovery worker protocol payload' }
    }
    const filename = String(request.result_filename || '')
    if (filename !== uiTestingDiscoveryFilename(task.task_id)) return { status:'failed', error:'UI discovery payload names a foreign result artifact' }
    const requestFilename = String(request.request_filename || '')
    if (!/^whx_ui_test_discovery_req_cat_[a-f0-9]{20}\.zip$/.test(requestFilename) || request.task_id !== task.task_id) {
      return { status:'failed', error:'UI discovery payload names an invalid request archive' }
    }
    const bootstrap = String(payload.bootstrap || '').trim()
    if (!bootstrap) return { status:'failed', error:'UI discovery payload has no composer bootstrap' }
    let archive
    try { archive = Buffer.from(String(payload.archive_base64 || ''), 'base64') } catch { archive = undefined }
    if (!archive?.byteLength || archive.byteLength > MAX_UI_TEST_DISCOVERY_REQUEST_BYTES) {
      return { status:'failed', error:'UI discovery request archive is invalid' }
    }

    await paceChatGPTWorkerSubmission()
    const delay = chatAgentRateLimitDelayMs()
    if (delay > 0) return { status:'waiting', delayMs:delay, observation:true, error:'ChatGPT rate-limit cooldown is active' }

    const dir = path.join(app.getPath('temp'), 'wharnex-ui-testing', task.task_id)
    const sourcePath = path.join(dir, requestFilename)
    await rm(dir, { recursive:true, force:true }).catch(() => undefined)
    await mkdir(dir, { recursive:true, mode:0o700 })
    await writeFile(sourcePath, archive, { mode:0o600 })

    let resolveDownload
    let rejectDownload
    const download = new Promise((resolve, reject) => { resolveDownload = resolve; rejectDownload = reject })
    download.catch(() => undefined)
    const expected = { taskId:task.task_id, key, filename, armedAt:Date.now(), resolve:resolveDownload, reject:rejectDownload }
    expectedChatGPTUITestDiscoveries.set(filename, expected)
    reconcileChatGPTThrottleForKey(key, entry)

    if (Number(task.attempt || 0) > 0) {
      const { wc } = requireOwnedChatGPTEntry(key, entry)
      await paceChatGPTWorkerSubmission()
      wc.reload()
      await waitForChatGPTSurfaceReady(key, entry)
    }

    let conversationUrl = ''
    try {
      const target = await targetChatGPTComposer(key, CHATGPT_URL, false, entry)
      target.reasoningEffort = 'instant'
      if (!await executeChatGPTDOMScript(key, target.entry, 'ui-discovery-fill', chatGPTFillComposerScript(bootstrap))) {
        throw new Error('ChatGPT UI discovery composer could not be populated')
      }
      await pasteChatGPTFile(target.entry, sourcePath, 1, 1, { pacedWorker:true })
      await wait(chatInputSettleDelay(archive.byteLength, 1))
      await executeChatGPTDOMScript(key, target.entry, 'ui-discovery-refill', chatGPTFillComposerScript(bootstrap))
      expected.assistantBaseline = await chatGPTAssistantTurnCount(target.wc)
      await submitChatGPTDraft(key, target.entry, target.conversationUrl, target, { requireReasoningEffort:false, rateLimitExempt:false })
      conversationUrl = await waitForSubmittedChatGPTConversation(key, target.entry, target.conversationUrl)
      if (!conversationUrl) throw new Error('ChatGPT UI discovery submission has no stable conversation id')

      const deadline = Date.now() + UI_TEST_DISCOVERY_TIMEOUT_MS
      while (Date.now() < deadline) {
        const outcome = await Promise.race([
          download.then((value) => ({ done:true, value }), (error) => ({ done:true, error })),
          wait(MARKDOWN_TRANSLATION_POLL_MS).then(() => ({ done:false })),
        ])
        if (outcome.done) {
          if (outcome.error) throw outcome.error
          const doc = await post(`/api/ui-testing/tasks/${task.task_id}/discovery`, { filename, bundle_base64:outcome.value.toString('base64') })
          return { status:'done', payload:{ protocol:'harness.ui-test-discovery-result/v1', environments:doc.environments?.length || 0, tests:doc.tests?.length || 0 } }
        }
        const health = await executeChatGPTDOMScript(key, target.entry, 'ui-discovery-health', chatGPTHumanActionScript())
        if (noteChatGPTRateLimitGate(key, health)) return { status:'waiting', delayMs:chatAgentRateLimitDelayMs(), observation:true, error:'ChatGPT rate-limit gate is active' }
        if (health?.required === true) {
          const kind = String(health.kind || 'verification')
          setChatGPTHumanAction(key, kind, '', 'ui-discovery-worker')
          return { status:'attention', providerWide:true, error:chatGPTHumanActionMessage(kind) }
        }
        await pollWorkerExpectedDownload(expected,
          (script) => executeChatGPTDOMScript(key, target.entry, 'ui-discovery-download', script), chatGPTExpectedDownloadScript)
      }
      throw new Error(`ChatGPT did not provide ${filename} before the UI discovery timeout`)
    } finally {
      if (expectedChatGPTUITestDiscoveries.get(filename) === expected) {
        expectedChatGPTUITestDiscoveries.delete(filename)
        reconcileChatGPTThrottleForKey(key, entry)
      }
      await rm(dir, { recursive:true, force:true }).catch(() => undefined)
      if (conversationUrl) {
        enqueueChatAgentTask('DELETE_TEMP_CHAT', {
          key, requestId:task.task_id, rootRequestId:task.task_id, conversationURL:conversationUrl,
          parentTaskID:task.task_id, dedupeKey:`delete-ui-discovery:${chatAgentConversationID(conversationUrl)}`, payload:{}, maxAttempts:4,
        }).catch(() => undefined)
      }
    }
  }

  return { discover }
}
