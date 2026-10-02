export function createUITestingChat(context) {
  const {
    paceChatGPTWorkerSubmission, targetChatGPTComposer, CHATGPT_URL, executeChatGPTDOMScript,
    chatGPTFillComposerScript, pasteChatGPTFile, wait, chatInputSettleDelay, chatGPTAssistantTurnCount,
    submitChatGPTDraft, waitForSubmittedChatGPTConversation, chatGPTResponseCompletionScript,
  } = context

  async function start(entry, key) {
    const target = await targetChatGPTComposer(key, CHATGPT_URL, false, entry)
    target.reasoningEffort = 'instant'
    return { target, conversationUrl: target.conversationUrl || '' }
  }

  async function ask(state, key, text, attachmentPath = '') {
    await paceChatGPTWorkerSubmission()
    const { target } = state
    if (!await executeChatGPTDOMScript(key, target.entry, 'ui-testing-fill', chatGPTFillComposerScript(text))) throw new Error('ChatGPT UI testing composer could not be populated')
    if (attachmentPath) {
      await pasteChatGPTFile(target.entry, attachmentPath, 1, 1, { pacedWorker: true })
      await wait(chatInputSettleDelay(256_000, 1))
      await executeChatGPTDOMScript(key, target.entry, 'ui-testing-refill', chatGPTFillComposerScript(text))
    }
    const baseline = await chatGPTAssistantTurnCount(target.wc)
    await submitChatGPTDraft(key, target.entry, state.conversationUrl || target.conversationUrl, target, { requireReasoningEffort:false, rateLimitExempt:false })
    state.conversationUrl = await waitForSubmittedChatGPTConversation(key, target.entry, state.conversationUrl || target.conversationUrl)
    const deadline = Date.now() + 180_000
    while (Date.now() < deadline) {
      await wait(900)
      const completion = await executeChatGPTDOMScript(key, target.entry, 'ui-testing-completion', chatGPTResponseCompletionScript(baseline))
      if (completion?.complete || (Number(completion?.assistantCount || 0) > baseline && !completion?.thinking)) return latestText(key, target.entry)
    }
    throw new Error('ChatGPT UI testing iteration timed out')
  }

  async function latestText(key, entry) {
    const script = `(() => { const nodes=[...document.querySelectorAll('[data-message-author-role="assistant"]')]; const last=nodes[nodes.length-1]; if(!last)return ''; const body=last.querySelector('.markdown')||last; return (body.innerText||body.textContent||'').slice(0,50000) })()`
    return String(await executeChatGPTDOMScript(key, entry, 'ui-testing-read-answer', script) || '')
  }

  return { start, ask }
}
