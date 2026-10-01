import { API_URL, invalidatePendingReads } from '../../transport/http/apiRequest'
import { openSessionEvents } from '../../transport/http/sessionEvents'
import type { LiveEventStream } from '../../transport/http/liveEventStream'

type Listener = () => void
type Watch = { sessionId: string; repository: string; listeners: Set<Listener> }
type SessionWatch = { source: LiveEventStream; watches: Set<Watch> }

const watches = new Map<string, Watch>()
const sessions = new Map<string, SessionWatch>()

function watchKey(sessionId: string, repository: string) {
  return `${sessionId}\0${repository}`
}

function notify(watch: Watch) {
  // A read started before this signal may contain the old overview.
  invalidatePendingReads(`/api/sessions/${encodeURIComponent(watch.sessionId)}/git/`)
  for (const listener of watch.listeners) listener()
}

function connectSession(sessionId: string): SessionWatch {
  const source = openSessionEvents(`${API_URL}/api/sessions/${encodeURIComponent(sessionId)}/events`)
  const session: SessionWatch = { source, watches: new Set() }
  source.onopen = () => {
    // A first connection or reconnect may have missed a change between the
    // mounted view's initial read and the backend's first Git sample.
    for (const watch of session.watches) notify(watch)
  }
  source.onmessage = ({ data }) => {
    try {
      const event = JSON.parse(data) as { type?: string; data?: { repository?: string } }
      if (event.type !== 'git.changed') return
      for (const watch of session.watches) {
        if (event.data?.repository === undefined || event.data.repository === watch.repository) notify(watch)
      }
    } catch { /* malformed transport frame */ }
  }
  sessions.set(sessionId, session)
  return session
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
    watch = { sessionId, repository, listeners: new Set() }
    watches.set(key, watch)
    const session = sessions.get(sessionId) || connectSession(sessionId)
    session.watches.add(watch)
  }
  watch.listeners.add(listener)
  return () => {
    const current = watches.get(key)
    if (!current) return
    current.listeners.delete(listener)
    if (current.listeners.size) return
    watches.delete(key)
    const session = sessions.get(sessionId)
    session?.watches.delete(current)
    if (session && !session.watches.size) {
      session.source.close()
      sessions.delete(sessionId)
    }
  }
}

export function announceGitChanged(sessionId: string, repository?: string) {
  for (const watch of watches.values()) {
    if (watch.sessionId === sessionId && (repository === undefined || watch.repository === repository)) notify(watch)
  }
}
