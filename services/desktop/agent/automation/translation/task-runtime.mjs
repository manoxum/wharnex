export function createTranslatorTaskRuntime({
  desktopWindows, createChatGPTWorkerView, publishChatAgentRuntimeState,
  chatAgentTaskPayload, assignChatGPTWorker, loadAndSettleChatGPTWorkerConversation,
  CHATGPT_URL, executeChatAgentMarkdownTranslation, chatAgentResidency,
  chatGPTWorkerEntries, retireChatGPTWorkerView,
}) {
  // Each translation owns a temporary provider view unless an idle Worker is lent.
  async function executeChatTranslatorTask(task, { entry: borrowedEntry } = {}) {
    if (task?.type !== 'TRANSLATE_MARKDOWN') return { status: 'failed', error: 'Translator accepts only TRANSLATE_MARKDOWN' }
    const host = [...desktopWindows.values()].find((state) => state.window && !state.window.isDestroyed())
    if (!host) return { status: 'failed', error: 'Translator has no host window' }

    const entry = borrowedEntry || createChatGPTWorkerView(`translator-${task.task_id}`, host)
    if (!borrowedEntry) { entry.ephemeralTask = task; publishChatAgentRuntimeState() }
    let assigned
    try {
      const payload = chatAgentTaskPayload(task)
      assigned = assignChatGPTWorker(entry, { ...task, payload })
      await loadAndSettleChatGPTWorkerConversation(
        assigned.key, entry, CHATGPT_URL, 'chat-agent-translate-markdown', assigned.assignment, { translation: true },
      )
      return await executeChatAgentMarkdownTranslation(task, entry, assigned.key, payload)
    } catch (error) {
      if (assigned) chatAgentResidency.cancelAssignment(entry.slotId, assigned.assignment.epoch)
      return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
    } finally {
      if (borrowedEntry) chatAgentResidency.releaseResidentLane(entry.slotId)
      else {
        const index = chatGPTWorkerEntries.indexOf(entry)
        if (index >= 0) chatGPTWorkerEntries.splice(index, 1)
        retireChatGPTWorkerView(entry)
        console.log(`[translator] destroyed task=${task.task_id}`)
        publishChatAgentRuntimeState()
      }
    }
  }

  return { executeChatTranslatorTask }
}
