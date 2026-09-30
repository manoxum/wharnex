export function createManualPromptAttachments(context) {
  const {
    sanitizeChatCacheKey,
    targetChatGPTComposer,
    normalizeChatGPTReasoningEffort,
    fetchContextZip,
    path,
    app,
    rm,
    mkdir,
    writeFile,
    pasteChatGPTFile,
    wait,
    chatInputSettleDelay,
    submitChatGPTDraft,
    waitForSubmittedChatGPTConversation,
    touchChatGPTEntry,
    plannerPromptMarkdown,
  } = context

  async function attachContextToChatGPT(request, entryOverride = undefined) {
    const key = sanitizeChatCacheKey(request?.cacheKey)
    const target = await targetChatGPTComposer(key, request?.url || '', true, entryOverride)
    target.reasoningEffort = normalizeChatGPTReasoningEffort(request?.reasoningEffort)
    target.entry.reasoningEffort = target.reasoningEffort
    const context = await fetchContextZip(request?.sessionId)
    const dir = path.join(app.getPath('temp'), 'wharness-chat-inputs', key, 'manual-context')
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const filePath = path.join(dir, `wharness-context-${context.id}.zip`)
    await writeFile(filePath, context.bytes, { mode: 0o600 })
    await pasteChatGPTFile(target.entry, filePath, 1, 1)
    await wait(chatInputSettleDelay(context.bytes.byteLength, 1))
    const submission = await submitChatGPTDraft(key, target.entry, target.conversationUrl, target)
    if (!submission.accepted) throw new Error('ChatGPT context submission was dispatched but could not be confirmed')
    const conversationUrl = await waitForSubmittedChatGPTConversation(key, target.entry, target.conversationUrl)
    touchChatGPTEntry(target.entry)
    return { ok: true, cacheKey: key, bytes: context.bytes.byteLength, submitted: true, conversationUrl }
  }

  async function attachPromptToChatGPT(request, entryOverride = undefined) {
    const text = String(request?.text || '').trim()
    if (!text) throw new Error('Prepared prompt is empty')
    if (text.length > 1024 * 1024) throw new Error('Prepared prompt exceeds 1 MiB limit')
    const key = sanitizeChatCacheKey(request?.cacheKey)
    const target = await targetChatGPTComposer(key, request?.url || '', true, entryOverride)
    target.reasoningEffort = normalizeChatGPTReasoningEffort(request?.reasoningEffort)
    target.entry.reasoningEffort = target.reasoningEffort
    const prompt = plannerPromptMarkdown(text)
    const dir = path.join(app.getPath('temp'), 'wharness-chat-inputs', key, 'manual-prompt')
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const filePath = path.join(dir, prompt.name)
    await writeFile(filePath, prompt.bytes, { mode: 0o600 })
    await pasteChatGPTFile(target.entry, filePath, 1, 1)
    await wait(chatInputSettleDelay(prompt.bytes.byteLength, 1))
    const submission = await submitChatGPTDraft(key, target.entry, target.conversationUrl, target)
    if (!submission.accepted) throw new Error('ChatGPT prompt submission was dispatched but could not be confirmed')
    const conversationUrl = await waitForSubmittedChatGPTConversation(key, target.entry, target.conversationUrl)
    touchChatGPTEntry(target.entry)
    return { ok: true, cacheKey: key, bytes: prompt.bytes.byteLength, submitted: true, conversationUrl }
  }

  return { attachContextToChatGPT, attachPromptToChatGPT }
}
