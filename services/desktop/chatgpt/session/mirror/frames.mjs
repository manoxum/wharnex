const FRAME_INTERVAL_MS = 100
const JPEG_QUALITY = 78
const MONITOR_WINDOW_ID = 'browser-monitor'

// The real agent views live in the browser monitor window; a project window
// shows the surface it asked for (its Engine Supervisor, or the Worker it
// surfaced) as a mirror of that view's live renderer. Frames are pixels for the
// local user only: never persisted, logged or interpreted.
export function createProjectSurfaceMirror({
  desktopWindows, chatgptViews, chatGPTWorkerEntries,
  setInterval: schedule = globalThis.setInterval, clearInterval: unschedule = globalThis.clearInterval,
}) {
  const busy = new WeakSet()
  const lastFrames = new WeakMap()
  let timer

  function mirrorTargets() {
    const targets = []
    for (const state of desktopWindows.values()) {
      const win = state.window
      if (state.id === MONITOR_WINDOW_ID || !win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) continue
      const key = String(state.activeChatGPTKey || '')
      const supervisor = key ? chatgptViews.get(key) : undefined
      if (supervisor && supervisor.ownerWindowId === state.id && supervisor.view.isVisible?.()) {
        targets.push({ state, entry: supervisor, channel: 'wharness:chatgpt:mirror-frame', identity: { cacheKey: key } })
      }
      const agentId = String(state.activeAgentInteractionId || '')
      const worker = agentId ? chatGPTWorkerEntries.find((candidate) => candidate.slotId === agentId && candidate.interactionWindowId === state.id) : undefined
      if (worker && worker.view.isVisible?.()) {
        targets.push({ state, entry: worker, channel: 'wharness:agents:mirror-frame', identity: { agentId } })
      }
    }
    return targets
  }

  async function mirror({ state, entry, channel, identity }) {
    const wc = entry.view.webContents
    if (busy.has(entry) || wc.isDestroyed()) return
    busy.add(entry)
    try {
      const image = await wc.capturePage(undefined, { stayHidden: true, stayAwake: true })
      if (image.isEmpty()) throw new Error('empty frame')
      const data = image.toJPEG(JPEG_QUALITY)
      const previous = lastFrames.get(state)
      // An unchanged page costs nothing to keep showing.
      if (previous?.entry === entry && previous.data.equals(data)) return
      lastFrames.set(state, { entry, data })
      const { width, height } = image.getSize()
      const contents = state.window.webContents
      if (!contents.isDestroyed()) contents.send(channel, { ...identity, width, height, data })
    } catch {
      // A view that never composited a frame has no surface to capture yet.
      if (!wc.isDestroyed()) entry.view.paint?.()
    } finally {
      busy.delete(entry)
    }
  }

  function tick() {
    for (const target of mirrorTargets()) void mirror(target)
  }

  function start() {
    if (!timer) timer = schedule(tick, FRAME_INTERVAL_MS)
  }

  function stop() {
    if (timer) unschedule(timer)
    timer = undefined
  }

  return { start, stop, tick, mirrorTargets }
}
