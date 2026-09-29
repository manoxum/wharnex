export const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8888'

export class APIError extends Error {
  constructor(message: string, public status: number, public data?: unknown) {
    super(message)
  }
}

type Snapshot = { etag: string; data: unknown }

// Polled GET snapshots the engine validates with an ETag. On 304 the request
// resolves to the exact object the previous poll produced, so the JSON is not
// parsed again and a React state update with it is a no-op instead of a
// re-render of the whole tree. Bounded, least recently used first out.
const MAX_SNAPSHOTS = 48
const snapshots = new Map<string, Snapshot>()

function rememberSnapshot(path: string, etag: string, data: unknown) {
  snapshots.delete(path)
  snapshots.set(path, { etag, data })
  if (snapshots.size > MAX_SNAPSHOTS) snapshots.delete(snapshots.keys().next().value as string)
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase()
  const cached = method === 'GET' ? snapshots.get(path) : undefined
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    // The validator lives here, not in the browser cache: a browser-cache 304
    // still hands fetch a fresh body to parse.
    ...(method === 'GET' ? { cache: 'no-store' as RequestCache } : {}),
    headers: { 'Content-Type': 'application/json', ...(cached ? { 'If-None-Match': cached.etag } : {}), ...(init?.headers || {}) },
  })
  if (response.status === 304 && cached) {
    rememberSnapshot(path, cached.etag, cached.data)
    return cached.data as T
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = data?.error?.message || `HTTP ${response.status}`
    throw new APIError(message, response.status, data)
  }
  const etag = method === 'GET' ? response.headers.get('ETag') : null
  if (etag) rememberSnapshot(path, etag, data)
  else if (method === 'GET') snapshots.delete(path)
  return data as T
}
