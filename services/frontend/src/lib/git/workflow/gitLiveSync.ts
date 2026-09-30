import { api } from '../../transport/http/api'

type Listener = () => void
type Watch = { sessionId: string; repository: string; listeners: Set<Listener>; timer?: number; signature?: string; running: boolean }

const watches = new Map<string, Watch>()
const POLL_MS = 1000

function watchKey(sessionId: string, repository: string) {
  return `${sessionId}\0${repository}`
}

function signatureOf(head: Awaited<ReturnType<typeof api.gitHead>>) {
  return `${head.current_branch || ''}|${head.detached ? '1' : '0'}|${head.commit_sha || ''}`
}

async function sample(watch: Watch) {
  if (watch.running) return
  watch.running = true
  try {
    const head = await api.gitHead(watch.sessionId, watch.repository)
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

export function subscribeGitLiveSync(sessionId: string, repository: string, listener: Listener): () => void
export function subscribeGitLiveSync(sessionId: string, listener: Listener): () => void
export function subscribeGitLiveSync(sessionId: string, repositoryOrListener: string | Listener, maybeListener?: Listener) {
  if (!sessionId) return () => {}
  const repository = typeof repositoryOrListener === 'string' ? repositoryOrListener : ''
  const listener = typeof repositoryOrListener === 'function' ? repositoryOrListener : maybeListener
  if (!listener) return () => {}
  const key = watchKey(sessionId, repository)
  let watch = watches.get(key)
  if (!watch) {
    const created: Watch = { sessionId, repository, listeners: new Set(), running: false }
    watches.set(key, created)
    void sample(created)
    created.timer = window.setInterval(() => { void sample(created) }, POLL_MS)
    watch = created
  }
  watch.listeners.add(listener)
  return () => {
    const current = watches.get(key)
    if (!current) return
    current.listeners.delete(listener)
    if (current.listeners.size === 0) {
      if (current.timer !== undefined) window.clearInterval(current.timer)
      watches.delete(key)
    }
  }
}

export function announceGitChanged(sessionId: string, repository?: string) {
  for (const watch of watches.values()) {
    if (watch.sessionId !== sessionId) continue
    if (repository !== undefined && watch.repository !== repository) continue
    watch.signature = undefined
    for (const listener of watch.listeners) listener()
    void sample(watch)
  }
}
