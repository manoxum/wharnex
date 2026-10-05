// UI Lab's ChatGPT transport. Every exchange is one engine-built request ZIP
// out and one exact response ZIP back (AGENTS.md, bundle-only provider
// protocol): this module attaches, submits and captures the download, and
// never reads assistant prose. The backend composes and validates both sides.

const RESULT_NAME = /^whx_ui_test_(step|guide)_res_(cat_[a-f0-9]{20})(?:_[0-9]{1,3})?\.zip$/
export const UI_TEST_EXCHANGE_TIMEOUT_MS = 4 * 60 * 1000

export function createUITestingChat(context) {
  const {
    paceChatGPTWorkerSubmission, chatAgentRateLimitDelayMs, targetChatGPTComposer, CHATGPT_URL, executeChatGPTDOMScript,
    chatGPTFillComposerScript, pasteChatGPTFile, wait, chatInputSettleDelay, chatGPTAssistantTurnCount,
    submitChatGPTDraft, waitForSubmittedChatGPTConversation, expectedChatGPTUITestDiscoveries, reconcileChatGPTThrottleForKey,
    chatGPTHumanActionScript, noteChatGPTRateLimitGate, setChatGPTHumanAction, chatGPTHumanActionMessage,
    pollWorkerExpectedDownload, chatGPTExpectedDownloadScript, enqueueChatAgentTask, chatAgentConversationID,
    MAX_UI_TEST_DISCOVERY_REQUEST_BYTES, MARKDOWN_TRANSLATION_POLL_MS = 1000, path, app, mkdir, writeFile, rm,
  } = context

  async function start(entry, key) {
    const target = await targetChatGPTComposer(key, CHATGPT_URL, false, entry)
    target.reasoningEffort = 'instant'
    return { target, conversationUrl: target.conversationUrl || '' }
  }

  // Sends one issued request and resolves with the exact response bundle bytes.
  async function exchange(state, key, taskId, issued, { timeoutMs = UI_TEST_EXCHANGE_TIMEOUT_MS } = {}) {
    const filename = String(issued?.request?.result_filename || '')
    const requestFilename = String(issued?.request?.request_filename || '')
    const match = RESULT_NAME.exec(filename)
    if (!match || match[2] !== taskId || requestFilename !== filename.replace('_res_', '_req_')) throw new Error('UI test exchange names a foreign artifact')
    const archive = Buffer.from(String(issued.archive_base64 || ''), 'base64')
    if (!archive.byteLength || archive.byteLength > MAX_UI_TEST_DISCOVERY_REQUEST_BYTES) throw new Error('UI test exchange archive is invalid')
    const bootstrap = String(issued.bootstrap || '').trim()
    if (!bootstrap) throw new Error('UI test exchange has no composer bootstrap')

    await paceChatGPTWorkerSubmission()
    const delay = chatAgentRateLimitDelayMs()
    if (delay > 0) throw Object.assign(new Error('ChatGPT rate-limit cooldown is active'), { deferMs: delay })
    const dir = path.join(app.getPath('temp'), 'wharnex-ui-testing', taskId)
    const sourcePath = path.join(dir, requestFilename)
    await mkdir(dir, { recursive:true, mode:0o700 })
    await writeFile(sourcePath, archive, { mode:0o600 })

    // Re-target before every exchange: the page may have navigated, reloaded
    // or opened an overlay while the browser under test was working.
    state.target = await targetChatGPTComposer(key, state.conversationUrl || CHATGPT_URL, true, state.target.entry)
    state.target.reasoningEffort = 'instant'
    const { target } = state
    let resolve, reject
    const download = new Promise((ok, fail) => { resolve = ok; reject = fail })
    download.catch(() => undefined)
    const expected = { taskId, key, filename, armedAt:Date.now(), resolve, reject }
    expectedChatGPTUITestDiscoveries.set(filename, expected)
    reconcileChatGPTThrottleForKey(key, target.entry)
    try {
      if (!await executeChatGPTDOMScript(key, target.entry, 'ui-test-fill', chatGPTFillComposerScript(bootstrap))) throw new Error('ChatGPT UI test composer could not be populated')
      await pasteChatGPTFile(target.entry, sourcePath, 1, 1, { pacedWorker:true })
      await wait(chatInputSettleDelay(archive.byteLength, 1))
      if (!await executeChatGPTDOMScript(key, target.entry, 'ui-test-refill', chatGPTFillComposerScript(bootstrap))) throw new Error('ChatGPT UI test composer could not be restored after attachment')
      expected.assistantBaseline = await chatGPTAssistantTurnCount(target.wc)
      await submitChatGPTDraft(key, target.entry, state.conversationUrl || target.conversationUrl, target, { requireReasoningEffort:false, rateLimitExempt:false })
      state.conversationUrl = await waitForSubmittedChatGPTConversation(key, target.entry, state.conversationUrl || target.conversationUrl) || state.conversationUrl
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const outcome = await Promise.race([
          download.then((value) => ({ done:true, value }), (error) => ({ done:true, error })),
          wait(MARKDOWN_TRANSLATION_POLL_MS).then(() => ({ done:false })),
        ])
        if (outcome.done) {
          if (outcome.error) throw outcome.error
          return { filename, bytes:outcome.value }
        }
        await assertHealthy(key, target)
        await pollWorkerExpectedDownload(expected, (script) => executeChatGPTDOMScript(key, target.entry, 'ui-test-download', script), chatGPTExpectedDownloadScript)
      }
      throw new Error(`ChatGPT did not provide ${filename} before the UI test timeout`)
    } finally {
      if (expectedChatGPTUITestDiscoveries.get(filename) === expected) {
        expectedChatGPTUITestDiscoveries.delete(filename)
        reconcileChatGPTThrottleForKey(key, target.entry)
      }
      await rm(sourcePath, { force:true }).catch(() => undefined)
    }
  }

  async function assertHealthy(key, target) {
    const health = await executeChatGPTDOMScript(key, target.entry, 'ui-test-health', chatGPTHumanActionScript())
    if (noteChatGPTRateLimitGate(key, health)) throw Object.assign(new Error('ChatGPT rate-limit gate is active'), { deferMs:chatAgentRateLimitDelayMs() })
    if (health?.required === true) {
      const kind = String(health.kind || 'verification')
      setChatGPTHumanAction(key, kind, '', 'ui-test-worker')
      throw Object.assign(new Error(chatGPTHumanActionMessage(kind)), { humanAction:kind })
    }
  }

  // The run's conversation is Wharnex-owned scratch; retire it once finished.
  function close(state, key, taskId) {
    const url = state?.conversationUrl
    if (!url) return
    enqueueChatAgentTask('DELETE_TEMP_CHAT', {
      key, requestId:taskId, rootRequestId:taskId, conversationURL:url, parentTaskID:taskId,
      dedupeKey:`delete-ui-test-run:${chatAgentConversationID(url)}`, payload:{}, maxAttempts:4,
    }).catch(() => undefined)
  }

  return { start, exchange, close }
}
