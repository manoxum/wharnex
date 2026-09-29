import { contextBundleURL, sanitizeSessionId } from '../security.mjs'
import { contextSelectionFromSession } from '../chat-input-context-selection.mjs'

export function createChatGPTRequestContextClient({ backendURL, maxContextBytes, fetchImpl = fetch }) {
  async function fetchContextZip(sessionId, signal) {
    const id = sanitizeSessionId(sessionId)
    const response = await fetchImpl(contextBundleURL(backendURL, id), { redirect: 'error', signal })
    if (!response.ok) throw new Error(`Context bundle HTTP ${response.status}`)
    const contentLength = Number(response.headers.get('content-length') || 0)
    if (contentLength > maxContextBytes) throw new Error('Context ZIP exceeds 256 MiB desktop limit')
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength > maxContextBytes) throw new Error('Context ZIP exceeds 256 MiB desktop limit')
    if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Backend did not return a ZIP bundle')
    const mapsURL = new URL(`/api/sessions/${encodeURIComponent(id)}/context/maps`, backendURL)
    const mapsResponse = await fetchImpl(mapsURL, { redirect: 'error', signal })
    const maps = await mapsResponse.json().catch(() => ({}))
    if (!mapsResponse.ok || maps?.protocol !== 'harness.context-map/v1' || !Array.isArray(maps?.files)) {
      throw new Error(maps?.error?.message || `Context maps HTTP ${mapsResponse.status}`)
    }
    return { id, bytes, maps: maps.files }
  }

  async function fetchChatContextSelection(sessionId, signal) {
    const target = new URL(`/api/sessions/${encodeURIComponent(sanitizeSessionId(sessionId))}`, backendURL)
    const response = await fetchImpl(target, { redirect: 'error', signal })
    if (!response.ok) throw new Error(`Context selection unavailable: HTTP ${response.status}`)
    return contextSelectionFromSession(await response.json())
  }

  // The captured snapshot plus the session's Full/Partial selection of it.
  async function fetchSelectedContextZip(sessionId, signal) {
    const [captured, selection] = await Promise.all([fetchContextZip(sessionId, signal), fetchChatContextSelection(sessionId, signal)])
    return { ...captured, ...selection }
  }

  async function fetchRequestGitContext(sessionId, signal) {
    const id = sanitizeSessionId(sessionId)
    const target = new URL(`/api/sessions/${encodeURIComponent(id)}/git/context`, backendURL)
    const response = await fetchImpl(target, { redirect: 'error', signal })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || body?.protocol !== 'harness.git-context/v1') throw new Error(body?.error?.message || `Git context HTTP ${response.status}`)
    return body
  }

  async function fetchRequestKnowledge(sessionId, requestId, signal) {
    const id = sanitizeSessionId(sessionId)
    const rid = String(requestId || '').trim()
    if (!/^req_[A-Za-z0-9_-]{8,180}$/.test(rid)) throw new Error('Invalid request id for project knowledge snapshot')
    const target = new URL(`/api/sessions/${encodeURIComponent(id)}/requests/${encodeURIComponent(rid)}/knowledge`, backendURL)
    const response = await fetchImpl(target, { redirect: 'error', signal })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || !body?.knowledge) throw new Error(body?.error?.message || `Request knowledge HTTP ${response.status}`)
    return body.knowledge
  }

  async function fetchRequestContinuation(sessionId, requestId, signal) {
    const id = sanitizeSessionId(sessionId)
    const rid = String(requestId || '').trim()
    if (!/^req_[A-Za-z0-9_-]{8,180}$/.test(rid)) throw new Error('Invalid request id for continuation artifacts')
    const target = new URL(`/api/sessions/${encodeURIComponent(id)}/requests/${encodeURIComponent(rid)}/continuation`, backendURL)
    const response = await fetchImpl(target, { redirect: 'error', signal })
    const body = await response.json().catch(() => ({}))
    // The attempt ledger and divergence report exist to make the NEXT round
    // cheaper; failing to fetch them must never block the request they travel
    // with. The prompt already carries both sections in full.
    if (!response.ok || !Array.isArray(body?.files)) return []
    return body.files
  }

  return {
    fetchContextZip, fetchChatContextSelection, fetchSelectedContextZip,
    fetchRequestGitContext, fetchRequestKnowledge, fetchRequestContinuation,
  }
}
