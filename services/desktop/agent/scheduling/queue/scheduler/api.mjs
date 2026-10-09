// HTTP client for the durable browser-agent queue owned by the backend.

async function requestJSON(fetchImpl, baseURL, path, init = {}) {
  const response = await fetchImpl(new URL(path, baseURL).href, {
    redirect: 'error',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  if (!response.ok) {
    let detail = ''
    try { detail = (await response.json())?.error?.message || '' } catch {}
    throw new Error(`chat-agent API ${response.status}${detail ? `: ${detail}` : ''}`)
  }
  return response.json()
}

export function createChatAgentQueueAPI({ baseURL, fetchImpl }) {
  const request = (path, init) => requestJSON(fetchImpl, baseURL, path, init)
  const post = (path, body, headers) => request(path, { method: 'POST', body: JSON.stringify(body), ...(headers ? { headers } : {}) })
  const taskPath = (taskID, suffix) => `/api/chat-agent/tasks/${encodeURIComponent(taskID)}/${suffix}`
  return {
    enqueue: (task) => post('/api/chat-agent/tasks', task),
    claim: (body) => post('/api/chat-agent/tasks/claim', body),
    // The scheduler never reads a transitioned task back, so it asks for the
    // lease-state acknowledgement instead of the whole task and its payload.
    transition: (taskID, action, body) => post(taskPath(taskID, action), body, { Prefer: 'return=minimal' }),
    recordTaskEvent: (taskID, body) => post(taskPath(taskID, 'events'), body),
    requestEvents: (requestID) => request(`/api/chat-agent/tasks/events?request_id=${encodeURIComponent(requestID)}&limit=1000`),
    list(query = {}) {
      const target = new URL('/api/chat-agent/tasks', baseURL)
      for (const [key, value] of Object.entries(query)) if (value !== '' && value != null) target.searchParams.set(key, String(value))
      return request(`${target.pathname}${target.search}`)
    },
    // Queue depth as an aggregate. Counting a listed page instead would go wrong
    // the moment settled history outgrows that page: the list is oldest-first, so
    // it fills with completed work and the live queue vanishes from the count.
    queueSummary: () => request('/api/chat-agent/tasks/summary'),
    cancelLineage: (rootRequestID) => post('/api/chat-agent/tasks/cancel-lineage', { root_request_id: rootRequestID }),
    providerState: () => request('/api/chat-agent/provider'),
    setProviderPause: (paused, { pausedUntil = null, reason = '' } = {}) =>
      request('/api/chat-agent/provider', { method: 'PUT', body: JSON.stringify({ paused, paused_until: pausedUntil, reason }) }),
    // kind preserves the evidence shape; cooldownSeconds is the bounded policy
    // selected by the operator and applied durably by the backend.
    recordRateLimit: (source, kind = 'transport', cooldownSeconds = 450) =>
      post('/api/chat-agent/provider/rate-limit', { source, kind, cooldown_seconds: cooldownSeconds }),
    // Durable automation holds: the UI test suspension and the account
    // file-upload limit this Desktop detected.
    automationHolds: () => request('/api/automation-holds'),
    setAutomationHold: (name, hold) =>
      request(`/api/automation-holds/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(hold) }),
    recordValidBundle: ({ requestId, conversationId = '', durationMs = 0 }) =>
      post('/api/chat-agent/provider/valid-bundle', { request_id: requestId, conversation_id: conversationId, duration_ms: durationMs }),
  }
}
