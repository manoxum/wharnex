export function createChatAgentTaskDispatcher(context) {
  const {
    workerEntryForIndex, executeChatTranslatorTask, chatAgentRateLimitDelayMs, chatGPTConversationReadGateMs,
    chatAgentTaskPayload, sanitizeChatCacheKey, chatAgentConversationURL, chatGPTSupervisorOwnsExpectedResponse,
    CHAT_AGENT_AWAIT_PROBE_MS, assignChatGPTWorker, chatAgentResidency, sameConversationURL,
    loadAndSettleChatGPTWorkerConversation, isTrustedChatGPTOrigin, CHATGPT_URL, waitForChatGPTSurfaceReady,
    ChatGPTRateLimitDeferral, CHAT_AGENT_STALE_ASSIGNMENT_RETRY_MS, executeChatAgentOrchestratorPlan, executeOrchestratorExecution,
    orchestratorExecutionWorkerRuntime, executeChatAgentTodoClassification, executeReleaseNotesBundleTask, releaseNotesWorkerRuntime, executeUITestingTask,
    probeChatAgentResponse, executeChatAgentWrite, executeChatAgentTitleDiscover, executeChatAgentTempTitle,
    executeChatAgentTitleAwait, executeChatAgentAccountTask,
  } = context

  async function executeChatAgentTask(task, { worker, owner, entry: ephemeralEntry }) {
    const entry = ephemeralEntry || workerEntryForIndex(worker)
    if (!entry) return { status: 'attention', providerWide: true, error: 'Autonomous worker browser is unavailable' }
    if (task.type === 'TRANSLATE_MARKDOWN') return executeChatTranslatorTask(task, { entry })
    const initialRateLimitDelay = chatAgentRateLimitDelayMs()
    if (initialRateLimitDelay > 0) {
      return { status: 'waiting', delayMs: initialRateLimitDelay, observation: true, error: 'ChatGPT rate-limit cooldown is active' }
    }
    const readCooldown = task.type === 'ORCHESTRATOR_EXECUTE' || task.type === 'ORCHESTRATOR_PLAN' ? chatGPTConversationReadGateMs(task.task_id) : 0
    if (readCooldown > 0) {
      return { status: 'waiting', delayMs: readCooldown, observation: true, error: 'ChatGPT conversation reads are cooling down' }
    }
    const payload = chatAgentTaskPayload(task)
    const taskKey = sanitizeChatCacheKey(task?.chat_id || task?.chatId)
    const taskConversationURL = chatAgentConversationURL(task, payload)
    if (task.type === 'AWAIT_RESPONSE' && chatGPTSupervisorOwnsExpectedResponse(taskKey, task.request_id, taskConversationURL)) {
      return { status: 'waiting', delayMs: CHAT_AGENT_AWAIT_PROBE_MS, observation: true, error: 'visible Supervisor owns response supervision' }
    }
    const assigned = assignChatGPTWorker(entry, { ...task, payload })
    const key = assigned.key
    const conversationURL = taskConversationURL || assigned.conversationURL
    // An Orchestrator execution opens its conversation itself, and only when the
    // attempt needs it: to resume a live request or to submit a new one. Opening
    // it at every claim spent a throttled conversation read on attempts that
    // only observed the Agent executing locally.
    const executorNavigates = task.type === 'ORCHESTRATOR_EXECUTE'
    try {
      if (assigned.assignment.rebind) {
        if (executorNavigates) {
          // A task's round driver opens the task's own conversation itself, and
          // only when a round needs the page. A blank page is never sent to the
          // home surface first: that cost a second full load on every start.
          if (!chatAgentResidency.settleAssignment(entry.slotId, assigned.assignment.epoch, assigned.lane)) throw new Error('stale worker assignment before execution')
        } else if (conversationURL && !sameConversationURL(entry.view.webContents.getURL(), conversationURL)) {
          await loadAndSettleChatGPTWorkerConversation(key, entry, conversationURL, `chat-agent-${String(task.type || '').toLowerCase()}`, assigned.assignment)
        } else if (!conversationURL && !isTrustedChatGPTOrigin(entry.view.webContents.getURL())) {
          // A fresh hidden Worker starts on about:blank. Background continuations
          // without a bound conversation must bootstrap it on the home surface.
          await loadAndSettleChatGPTWorkerConversation(key, entry, CHATGPT_URL, `chat-agent-${String(task.type || '').toLowerCase()}-bootstrap`, assigned.assignment)
        } else {
          await waitForChatGPTSurfaceReady(key, entry)
          if (!chatAgentResidency.settleAssignment(entry.slotId, assigned.assignment.epoch, assigned.lane)) throw new Error('stale worker assignment before execution')
        }
        const rateLimitDelay = chatAgentRateLimitDelayMs()
        if (rateLimitDelay > 0) return { status: 'waiting', delayMs: rateLimitDelay, observation: true, error: 'ChatGPT rate-limit cooldown is active' }
      }
      if (!chatAgentResidency.epochCurrent(entry.slotId, assigned.assignment.epoch, assigned.lane)) throw new Error('stale worker assignment epoch')
      // Taking a task always costs this slot its place in the rotation, whether
      // or not it had to rebind. A slot serving its own resident lane never
      // rebinds, so without this it would never leave the head of the queue.
      chatAgentResidency.noteAssignment(entry.slotId)
    } catch (error) {
      chatAgentResidency.cancelAssignment(entry.slotId, assigned.assignment.epoch)
      // Same reasoning as the stale-assignment branch below: the navigation was
      // abandoned at the pacing gate because the provider is suspended, so
      // nothing reached ChatGPT and the attempt budget must not be charged.
      if (error instanceof ChatGPTRateLimitDeferral) {
        return { status: 'waiting', delayMs: error.delayMs, observation: true, error: error.message }
      }
      // A slot rebound before execution began is a Wharnex-side race: nothing
      // reached ChatGPT, so this is one of the outcomes AGENTS.md requires to be
      // free. Rethrowing charged the attempt budget of a task that never made a
      // request, which is how healthy work retires as exhausted.
      if (/stale worker assignment/i.test(String(error?.message || ''))) {
        return {
          status: 'waiting', observation: true, delayMs: CHAT_AGENT_STALE_ASSIGNMENT_RETRY_MS,
          error: 'worker slot was reassigned before the task reached ChatGPT',
        }
      }
      throw error
    }
    switch (task.type) {
      case 'ORCHESTRATOR_PLAN': return executeChatAgentOrchestratorPlan(task, entry, key, payload, owner)
      case 'ORCHESTRATOR_EXECUTE': return executeOrchestratorExecution(task, entry, key, payload, owner, orchestratorExecutionWorkerRuntime())
      case 'TODO_CLASSIFY': return executeChatAgentTodoClassification(task, entry, key, payload)
      case 'RELEASE_NOTES': return executeReleaseNotesBundleTask(task, entry, key, payload, releaseNotesWorkerRuntime())
      case 'UI_TEST_DISCOVER':
      case 'UI_TEST_RUN': return executeUITestingTask(task, entry, key, payload)
      case 'AWAIT_RESPONSE': return probeChatAgentResponse(task, entry, key, payload, conversationURL)
      case 'BOT_WRITE':
      case 'RECOVERY_WRITE': return executeChatAgentWrite(task, entry, key, payload, conversationURL)
      case 'TITLE_DISCOVER': return executeChatAgentTitleDiscover(task, entry, key, payload, conversationURL)
      case 'TITLE_GENERATE_TEMP': return executeChatAgentTempTitle(task, entry, key, payload, conversationURL)
      case 'TITLE_AWAIT': return executeChatAgentTitleAwait(task, entry, key, payload)
      case 'ORGANIZE_CHAT':
      case 'RENAME_CHAT':
      case 'ARCHIVE_CHAT':
      case 'DELETE_CHAT':
      case 'DELETE_TEMP_CHAT':
      case 'DELETE_BUNDLE': return executeChatAgentAccountTask(task, entry, key, payload, conversationURL)
      default: return { status: 'failed', error: `Unsupported chat-agent task type ${task.type}` }
    }
  }

  return { executeChatAgentTask }
}
