export function publicChatAgentTask(task) {
  if (!task) return undefined
  return {
    task_id: String(task.task_id || ''), type: String(task.type || ''), chat_id: String(task.chat_id || ''), session_id: String(task.session_id || ''),
    // The pool is global, so a task must retain the project owning it.
    project_id: String(task.project_id || ''),
    request_id: String(task.request_id || ''), root_request_id: String(task.root_request_id || ''),
    conversation_id: String(task.conversation_id || ''), status: String(task.status || ''),
    attempt: Math.max(0, Number(task.attempt || 0)), max_attempts: Math.max(0, Number(task.max_attempts || 0)),
    assigned_worker: String(task.assigned_worker || ''), keep_flowing: task.keep_flowing === true,
    lease_expires_at: String(task.lease_expires_at || ''), not_before: String(task.not_before || ''),
    last_error: String(task.last_error || ''), created_at: String(task.created_at || ''), updated_at: String(task.updated_at || ''),
  }
}

// A settled last task owns the slot only while its engagement is still live.
export function chatAgentAgentProject(task, lastTask, engaged) {
  const current = String(task?.project_id || '').trim()
  if (current) return current
  return engaged ? String(lastTask?.project_id || '').trim() : ''
}

export function unavailableAgentBrowser() {
  return { available: false, web_contents_id: 0, os_process_id: 0, url: '', title: '', loading: false }
}

export function publicAgentBrowser(entry, sanitizeURL) {
  // A retiring WebContents may disappear between isDestroyed and any getter.
  try {
    const wc = entry?.view?.webContents
    if (!wc || wc.isDestroyed()) return unavailableAgentBrowser()
    const currentURL = wc.getURL() || ''
    let osProcessID = 0
    try { osProcessID = Math.max(0, Number(wc.getOSProcessId()) || 0) } catch {}
    return {
      available: true,
      web_contents_id: wc.id,
      os_process_id: osProcessID,
      url: currentURL ? sanitizeURL(currentURL) : '',
      title: wc.getTitle() || '',
      loading: Boolean(entry.loading),
    }
  } catch {
    return unavailableAgentBrowser()
  }
}
