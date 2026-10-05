// Continuation artifact paths are a fixed Wharnex-owned allowlist. Accepting an
// arbitrary path here would turn a backend response into a write primitive over
// the archive layout, so an unexpected name is refused rather than sanitized.
const CONTINUATION_PATHS = new Set([
  'attempts/state.json',
  'attempts/ledger.md',
  'attempts/events.json',
  'context-delta/delta.json',
  'context-delta/delta.patch',
  'conflict/capsule.json',
  'requests/main.md',
  'requests/adjustment.md',
  'responses/index.json',
])
const MAX_CONTINUATION_BYTES = 1 << 20
const MAX_CONFLICT_CAPSULE_BYTES = 4 << 20
const MAX_EXECUTION_HISTORY_BYTES = 16 << 20
const MAX_RESPONSE_HISTORY_BUNDLE_BYTES = 128 << 20

function continuationArtifactLimit(name) {
  if (name === 'conflict/capsule.json') return MAX_CONFLICT_CAPSULE_BYTES
  if (name === 'attempts/events.json') return MAX_EXECUTION_HISTORY_BYTES
  if (/^responses\/\d{3}-req_[A-Za-z0-9_-]{4,180}\.zip$/.test(name)) return MAX_RESPONSE_HISTORY_BUNDLE_BYTES
  if (CONTINUATION_PATHS.has(name)) return MAX_CONTINUATION_BYTES
  return 0
}

// harness.attempts/v1 and harness.context-delta/v1 travel as real files so a
// planner reading the archive sees the same measured round history and project
// divergence the prompt describes. The renderer never supplies a path.
export function normalizeContinuationFiles(values) {
  const list = Array.isArray(values) ? values : []
  const seen = new Set()
  return list.map((item) => {
    const name = String(item?.path || '').trim()
    const maxBytes = continuationArtifactLimit(name)
    if (!maxBytes) throw new Error(`Unsupported continuation artifact: ${name}`)
    if (seen.has(name)) throw new Error(`Duplicate continuation artifact: ${name}`)
    seen.add(name)
    const bytes = Buffer.from(String(item?.content_base64 || ''), 'base64')
    if (!bytes.byteLength || bytes.byteLength > maxBytes) throw new Error(`Invalid continuation artifact size: ${name}`)
    return { name, bytes }
  })
}
