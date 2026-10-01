export function createWorkspaceChatRemote({
  sanitizeChatCacheKey, canonicalChatGPTConversationURL, BACKEND_URL, fetch,
}) {
  function durableWorkspaceChatID(cacheKey, requestedChatID = '') {
    const key = sanitizeChatCacheKey(cacheKey)
    // Legacy releases created `_cf_` auxiliary surfaces. Never project one into
    // durable chat affinity while old queued work drains after an upgrade.
    if (key.includes('_cf_')) return ''
    // An Orchestrator task is a Main Request without a workspace chat.
    if (key.startsWith('otk_')) return ''
    const requested = String(requestedChatID || '').trim()
    if (!requested) return key
    const durableID = sanitizeChatCacheKey(requested)
    return durableID === key ? durableID : ''
  }

  async function persistWorkspaceChatRemote(chatID, conversationURL, { projectRef = '', remoteTitle = '', remoteState = '' } = {}) {
    const key = sanitizeChatCacheKey(chatID)
    const target = new URL(`/api/workspace-chats/${encodeURIComponent(key)}/remote`, BACKEND_URL)
    const response = await fetch(target, {
      method: 'PATCH', redirect: 'error', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatgpt_url: canonicalChatGPTConversationURL(conversationURL), remote_project_ref: projectRef, remote_title: remoteTitle, remote_state: remoteState }),
    })
    if (!response.ok) throw new Error(`workspace chat remote state HTTP ${response.status}`)
    return response.json()
  }

  async function persistWorkspaceChatRemoteBestEffort(chatID, conversationURL, values = {}) {
    try {
      return await persistWorkspaceChatRemote(chatID, conversationURL, values)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      console.warn(`[chatgpt-remote-state] non-fatal persistence failure chat=${sanitizeChatCacheKey(chatID)} state=${String(values?.remoteState || '')} error=${detail}`)
      return { ok: false, error: detail }
    }
  }

  return { durableWorkspaceChatID, persistWorkspaceChatRemote, persistWorkspaceChatRemoteBestEffort }
}
