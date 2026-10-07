export function createEphemeralWorkerRuntime({
  EPHEMERAL_WORKER_TASK_TYPES, EPHEMERAL_WORKER_IDLE_RETIRE_MS,
  EPHEMERAL_WORKER_PACE_PRIORITY, ephemeralWorkerViews, chatGPTWorkerEntries,
  desktopWindows, retireChatGPTWorkerView, createChatGPTWorkerView,
  publishChatAgentRuntimeState, chatAgentWorkerActivity,
  executeChatTranslatorTask, executeChatAgentTask,
  parkChatGPTWorkerAfterLoadFailure, releaseChatGPTConversationReadProbe,
  schedule = setInterval, now = Date.now,
}) {
  function retireEphemeralWorkerView(taskId, reason) {
    const kept = ephemeralWorkerViews.get(taskId)
    if (!kept) return
    ephemeralWorkerViews.delete(taskId)
    const index = chatGPTWorkerEntries.indexOf(kept.entry)
    if (index >= 0) chatGPTWorkerEntries.splice(index, 1)
    retireChatGPTWorkerView(kept.entry)
    console.log(`[ephemeral-worker] destroyed task=${taskId} reason=${reason}`)
    publishChatAgentRuntimeState()
  }

  // A cancelled task whose Worker never returns must not keep its view open.
  schedule(() => {
    const current = now()
    for (const [taskId, kept] of ephemeralWorkerViews) {
      if (!kept.running && current - kept.lastUsed > EPHEMERAL_WORKER_IDLE_RETIRE_MS) retireEphemeralWorkerView(taskId, 'idle')
    }
  }, 60_000).unref?.()

  async function executeEphemeralWorkerTask(task, context = {}) {
    if (!EPHEMERAL_WORKER_TASK_TYPES.has(task?.type)) return { status: 'failed', error: `Ephemeral Worker does not run ${String(task?.type || '')}` }
    if (task.type === 'TRANSLATE_MARKDOWN') {
      return chatAgentWorkerActivity.run(`translator-${task.task_id}`, task.task_id, () => executeChatTranslatorTask(task, {}), { priority: EPHEMERAL_WORKER_PACE_PRIORITY })
    }
    const host = [...desktopWindows.values()].find((state) => state.window && !state.window.isDestroyed())
    if (!host) return { status: 'failed', error: 'Ephemeral Worker has no host window' }
    return runEphemeral(task, context, host)
  }

  async function runEphemeral(task, context, host) {
    let kept = ephemeralWorkerViews.get(task.task_id)
    if (kept && kept.entry.view.webContents.isDestroyed()) {
      retireEphemeralWorkerView(task.task_id, 'destroyed')
      kept = undefined
    }
    if (!kept) {
      kept = { entry: createChatGPTWorkerView(`ephemeral-${task.task_id}`, host), lastUsed: now(), running: false }
      ephemeralWorkerViews.set(task.task_id, kept)
      publishChatAgentRuntimeState()
      console.log(`[ephemeral-worker] created task=${task.task_id} type=${task.type}`)
    }
    kept.running = true
    kept.entry.ephemeralTask = task
    let result
    try {
      result = await chatAgentWorkerActivity.run(kept.entry.slotId, task.task_id,
        () => executeChatAgentTask(task, { ...context, entry: kept.entry }), { priority: EPHEMERAL_WORKER_PACE_PRIORITY })
      return result
    } finally {
      kept.running = false
      kept.lastUsed = now()
      parkChatGPTWorkerAfterLoadFailure(kept.entry)
      releaseChatGPTConversationReadProbe(task.task_id)
      if (String(result?.status || '') !== 'waiting') retireEphemeralWorkerView(task.task_id, String(result?.status || 'error'))
    }
  }

  return { retireEphemeralWorkerView, executeEphemeralWorkerTask }
}
