export function createChatAgentTaskQueue({
  getRuntimeDiagnostics, getScheduler, getSupervisorScheduler, getPolicies,
  chatAgentConversationID, sanitizeChatCacheKey, canonicalChatGPTConversationURL,
  reconcileChatAgentAutoScale, persistWorkspaceChatRemote, createHash,
  refreshChatAgentRuntimeState, publishChatAgentRuntimeState,
}) {
  const CHAT_AGENT_REQUEST_BOUND_TASKS = new Set(['BOT_WRITE', 'RECOVERY_WRITE', 'AWAIT_RESPONSE', 'TITLE_DISCOVER', 'TITLE_GENERATE_TEMP', 'TITLE_AWAIT'])

  function chatAgentInitialRequestWaitMs() {
    const value = Number(getRuntimeDiagnostics()?.provider?.initial_wait_ms || 60_000)
    return Math.max(60_000, Math.min(15 * 60_000, Number.isFinite(value) ? value : 60_000))
  }

  function chatAgentRequestEligibleAt(type, payload = {}, explicit = undefined) {
    if (explicit) return explicit
    if (!CHAT_AGENT_REQUEST_BOUND_TASKS.has(String(type || ''))) return new Date().toISOString()
    const inherited = String(payload?.request_eligible_at || '').trim()
    if (inherited && Number.isFinite(Date.parse(inherited))) return inherited
    return new Date(Date.now() + chatAgentInitialRequestWaitMs()).toISOString()
  }

  async function enqueueChatAgentTask(type, { key, requestId = '', rootRequestId = '', conversationURL = '', parentTaskID = '', dedupeKey = '', payload = {}, maxAttempts = 8, notBefore = undefined, projectID = '', sessionID = '', retry = false }) {
    const chatAgentScheduler = getScheduler()
    if (!chatAgentScheduler) throw new Error('Chat-agent scheduler is not ready')
    const conversationID = chatAgentConversationID(conversationURL)
    const body = {
      type, project_id: String(projectID || ''), chat_id: sanitizeChatCacheKey(key), session_id: String(sessionID || ''),
      request_id: String(requestId || ''), root_request_id: String(rootRequestId || requestId || ''), conversation_id: conversationID,
      parent_task_id: String(parentTaskID || ''), dedupe_key: String(dedupeKey || ''), max_attempts: Number(maxAttempts || 8),
      not_before: chatAgentRequestEligibleAt(type, payload, notBefore), payload: { ...payload, conversation_url: canonicalChatGPTConversationURL(conversationURL) },
    }
    // A Main Request's AWAIT_RESPONSE task is its only durable record (see
    // AGENTS.md §8): a transient enqueue failure there must not leave a request
    // running with zero trace of it, so that one caller opts into a bounded
    // retry instead of the ordinary single-attempt enqueue every other task
    // type uses.
    const queued = retry ? await chatAgentScheduler.enqueueWithRetry(body) : await chatAgentScheduler.enqueue(body)
    // Supervisor and Worker claims are separate loops over the same queue. The
    // enqueue call wakes the Worker client that owns the HTTP request; explicitly
    // wake the complementary pool too so Supervisor work is seen immediately.
    getSupervisorScheduler()?.wake()
    if (getPolicies().auto_scale === true) void reconcileChatAgentAutoScale()
    return queued
  }

  async function enqueueChatAgentLifecycleTask(type, request = {}) {
    const key = sanitizeChatCacheKey(request.cacheKey)
    const conversationURL = canonicalChatGPTConversationURL(request.url || '')
    if (!conversationURL) throw new Error(`${type} requires a canonical ChatGPT conversation URL`)
    const conversationID = chatAgentConversationID(conversationURL) || key
    const title = String(request.title || '').replace(/\s+/g, ' ').trim().slice(0, 160)
    const projectName = String(request.projectName || '').trim().slice(0, 160)
    const requestId = String(request.requestId || '').trim()
    const dedupeSuffix = type === 'RENAME_CHAT'
      ? createHash('sha256').update(`${projectName}\0${title}`).digest('hex').slice(0, 16)
      : 'once'
    if (type === 'RENAME_CHAT' && !title) throw new Error('RENAME_CHAT requires a title')
    if (type === 'ARCHIVE_CHAT') {
      await persistWorkspaceChatRemote(key, conversationURL, { remoteState: 'archive-pending' })
    } else if (type === 'DELETE_CHAT') {
      await persistWorkspaceChatRemote(key, conversationURL, { remoteState: 'delete-pending' })
    }
    const task = await enqueueChatAgentTask(type, {
      key, requestId, rootRequestId: requestId, conversationURL,
      // Only the canonical host project path, never the ChatGPT display name:
      // that label is renameable from ChatGPT's own UI and is not an identity.
      // An absent path is resolved by the backend from the task's own chat.
      projectID: String(request.projectId || ''), sessionID: String(request.sessionId || ''),
      dedupeKey: `${type.toLowerCase()}:${conversationID}:${dedupeSuffix}`,
      payload: { project_name: projectName, title }, maxAttempts: type === 'RENAME_CHAT' ? 8 : 12,
    })
    void refreshChatAgentRuntimeState().then(publishChatAgentRuntimeState).catch(() => undefined)
    return { ok: true, state: 'queued', task_id: String(task?.task_id || ''), type }
  }

  return { chatAgentInitialRequestWaitMs, chatAgentRequestEligibleAt, enqueueChatAgentTask, enqueueChatAgentLifecycleTask }
}
