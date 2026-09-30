export function createAccountLifecycleExecutor(context) {
  const {
    organizeChatGPTConversation, chatAgentBackoff, accountFailureDetail, persistWorkspaceChatRemote,
    enqueueChatAgentTask, chatAgentConversationID, chatAgentLifecycleRetry, chatAgentLifecycleBlocked,
    archiveChatGPTConversation, deleteChatGPTConversation, parseBundleName, deleteChatGPTLibraryArtifact,
  } = context

  async function executeChatAgentAccountTask(task, entry, key, payload, conversationURL) {
    switch (task.type) {
      case 'ORGANIZE_CHAT': {
        const result = await organizeChatGPTConversation(key, payload.project_name, payload.title || payload.fallback_title, payload.target_url || conversationURL, entry)
        if (result.state === 'duplicate-project') return { status: 'attention', error: `Projeto ChatGPT duplicado: ${result.project}` }
        if (!result.ok) return { status: 'waiting', delayMs: chatAgentBackoff(task.attempt), error: accountFailureDetail(result) }
        await persistWorkspaceChatRemote(key, payload.target_url || conversationURL, { projectRef: result.project || '', remoteTitle: result.title || '', remoteState: 'organized' })
        if (payload.temp_url) await enqueueChatAgentTask('DELETE_TEMP_CHAT', { key, requestId: task.request_id, rootRequestId: task.root_request_id || task.request_id, conversationURL: payload.temp_url, parentTaskID: task.task_id, dedupeKey: `delete-temp:${chatAgentConversationID(payload.temp_url)}`, payload, maxAttempts: 6 })
        return { status: 'done' }
      }
      case 'RENAME_CHAT': {
        const result = await organizeChatGPTConversation(key, payload.project_name, payload.title, conversationURL, entry)
        if (!result.ok) return chatAgentLifecycleRetry(task, key, conversationURL, accountFailureDetail(result))
        await persistWorkspaceChatRemote(key, conversationURL, { projectRef: result.project || '', remoteTitle: result.title || payload.title || '', remoteState: 'organized' })
        return { status: 'done' }
      }
      case 'ARCHIVE_CHAT': {
        if (await chatAgentLifecycleBlocked(task)) return { status: 'waiting', delayMs: 5_000 }
        const result = await archiveChatGPTConversation(key, conversationURL, entry)
        if (!(result.ok || result.state === 'already-archived')) return chatAgentLifecycleRetry(task, key, conversationURL, accountFailureDetail(result))
        await persistWorkspaceChatRemote(key, conversationURL, { remoteState: 'archived' })
        return { status: 'done' }
      }
      case 'DELETE_CHAT':
      case 'DELETE_TEMP_CHAT': {
        if (task.type === 'DELETE_CHAT' && await chatAgentLifecycleBlocked(task)) return { status: 'waiting', delayMs: 5_000 }
        const result = await deleteChatGPTConversation(key, conversationURL, entry)
        if (!(result.ok || result.state === 'already-deleted')) return chatAgentLifecycleRetry(task, key, conversationURL, accountFailureDetail(result), { persist: task.type === 'DELETE_CHAT' })
        if (task.type === 'DELETE_CHAT') await persistWorkspaceChatRemote(key, conversationURL, { remoteState: 'deleted' })
        return { status: 'done' }
      }
      case 'DELETE_BUNDLE': {
        if (!payload.locally_persisted) return { status: 'attention', error: 'remote bundle cleanup requires confirmed local persistence' }
        const filename = String(payload.canonical_filename || '').trim()
        if (!filename || !parseBundleName(filename)) return { status: 'attention', error: 'exact canonical Wharnex bundle filename is required' }
        const result = await deleteChatGPTLibraryArtifact(key, filename, String(payload.artifact_id || ''), entry)
        if (result.ok || result.state === 'already-deleted') return { status: 'done' }
        if (result.state === 'artifact-ambiguous' || result.state === 'invalid-canonical-filename') return { status: 'attention', error: result.state }
        return { status: 'waiting', delayMs: chatAgentBackoff(task.attempt), error: accountFailureDetail(result) }
      }
      default: return { status: 'failed', error: `Unsupported account task type ${task.type}` }
    }
  }

  return { executeChatAgentAccountTask }
}
