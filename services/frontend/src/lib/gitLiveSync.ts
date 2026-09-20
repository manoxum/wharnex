import { api } from './api'

type Listener = () => void
type Watch = { listeners: Set<Listener>; timer?: number; signature?: string; running: boolean }

const watches = new Map<string, Watch>()
const POLL_MS = 1000

function signatureOf(head: Awaited<ReturnType<typeof api.gitHead>>) {
  return `${head.current_branch || ''}|${head.detached ? '1' : '0'}|${head.commit_sha || ''}`
}

async function sample(sessionId: string, watch: Watch) {
  if (watch.running) return
  watch.running = true
  try {
    const head = await api.gitHead(sessionId)
    const signature = signatureOf(head)
    if (watch.signature === undefined) watch.signature = signature
    else if (watch.signature !== signature) {
      watch.signature = signature
      for (const listener of watch.listeners) listener()
    }
  } catch {
    // Live sync is best-effort. Explicit Git actions still surface failures.
  } finally {
    watch.running = false
  }
}

export function subscribeGitLiveSync(sessionId: string, listener: Listener) {
  if (!sessionId) return () => {}
  let watch = watches.get(sessionId)
  if (!watch) {
    const created: Watch = { listeners: new Set(), running: false }
    watches.set(sessionId, created)
    void sample(sessionId, created)
    created.timer = window.setInterval(() => { void sample(sessionId, created) }, POLL_MS)
    watch = created
  }
  watch.listeners.add(listener)
  return () => {
    const current = watches.get(sessionId)
    if (!current) return
    current.listeners.delete(listener)
    if (current.listeners.size === 0) {
      if (current.timer !== undefined) window.clearInterval(current.timer)
      watches.delete(sessionId)
    }
  }
}

export function announceGitChanged(sessionId: string) {
  const watch = watches.get(sessionId)
  if (!watch) return
  watch.signature = undefined
  for (const listener of watch.listeners) listener()
  void sample(sessionId, watch)
}
