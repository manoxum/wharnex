const MONITOR_WINDOW_ID = 'browser-monitor'

function answer(event, request, port) {
  const reply = { requestId: String(request?.requestId || '').slice(0, 80), ok: Boolean(port) }
  event.sender.postMessage('wharness:mirror:port', reply, port ? [port] : [])
}

// The two subscription endpoints: a window's own Engine/ChatGPT Supervisor
// surface, and a Worker that window surfaced. Each answer carries a port.
export function registerAgentMirrorStreamIPC({
  ipcMain, trustedSender, sanitizeChatCacheKey, chatgptViews, chatGPTWorkerEntries, mirrorStreams,
}) {
  ipcMain.on('wharness:chatgpt:mirror-subscribe', (event, request) => {
    const windowState = trustedSender(event)
    const key = sanitizeChatCacheKey(request?.cacheKey)
    const owned = () => {
      const entry = chatgptViews.get(key)
      return Boolean(entry && entry.ownerWindowId === windowState.id && windowState.activeChatGPTKey === key)
    }
    answer(event, request, windowState.id !== MONITOR_WINDOW_ID && owned() ? mirrorStreams.subscribe(chatgptViews.get(key), windowState, owned) : undefined)
  })
  ipcMain.on('wharness:agents:mirror-subscribe', (event, request) => {
    const windowState = trustedSender(event)
    const agentId = String(request?.agentId || '')
    const worker = () => chatGPTWorkerEntries.find((candidate) => candidate.slotId === agentId)
    const surfaced = () => {
      const entry = worker()
      return Boolean(entry && entry.interactionWindowId === windowState.id && windowState.activeAgentInteractionId === agentId)
    }
    answer(event, request, surfaced() ? mirrorStreams.subscribe(worker(), windowState, surfaced) : undefined)
  })
}
