export const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8888'

export class APIError extends Error {
  constructor(message: string, public status: number, public data?: unknown) {
    super(message)
  }
}

type Snapshot = { etag: string; data: unknown }

// GET snapshots validated by the engine with an ETag. On 304 the request
// resolves to the previous object, avoiding JSON parsing and a React update.
const MAX_SNAPSHOTS = 48
const snapshots = new Map<string, Snapshot>()
const pendingReads = new Map<string, Promise<unknown>>()
const readTokens = new Map<string, object>()

// A server invalidation must not join a GET that began before the change.
export function invalidatePendingReads(prefix: string) {
  for (const path of pendingReads.keys()) {
    if (path.startsWith(prefix)) {
      pendingReads.delete(path)
      readTokens.delete(path)
    }
  }
}

function rememberSnapshot(path: string, etag: string, data: unknown) {
  snapshots.delete(path)
  snapshots.set(path, { etag, data })
  if (snapshots.size > MAX_SNAPSHOTS) snapshots.delete(snapshots.keys().next().value as string)
}

export function request<T>(path: string, init?: RequestInit): Promise<T> {
  // A single backend invalidation may wake several mounted consumers. Share
  // their simultaneous read, then allow the next change to fetch anew.
  if (init !== undefined) return performRequest<T>(path, init)
  const pending = pendingReads.get(path)
  if (pending) return pending as Promise<T>
  const token = {}
  readTokens.set(path, token)
  const read = performRequest<T>(path, undefined, () => readTokens.get(path) === token)
  pendingReads.set(path, read)
  void read.finally(() => {
    if (pendingReads.get(path) === read) pendingReads.delete(path)
    if (readTokens.get(path) === token) readTokens.delete(path)
  }).catch(() => {})
  return read
}

async function performRequest<T>(path: string, init?: RequestInit, current: () => boolean = () => true): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase()
  const cached = method === 'GET' ? snapshots.get(path) : undefined
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    // A request carrying If-None-Match bypasses the browser cache (Fetch
    // spec), so the 304 reaches this code instead of a re-served body.
    headers: { 'Content-Type': 'application/json', ...(cached ? { 'If-None-Match': cached.etag } : {}), ...(init?.headers || {}) },
  })
  if (response.status === 304 && cached) {
    if (current()) rememberSnapshot(path, cached.etag, cached.data)
    return cached.data as T
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = data?.error?.message || `HTTP ${response.status}`
    throw new APIError(message, response.status, data)
  }
  const etag = method === 'GET' ? response.headers?.get?.('ETag') : null
  if (current()) {
    if (etag) rememberSnapshot(path, etag, data)
    else if (method === 'GET') snapshots.delete(path)
  }
  return data as T
}
