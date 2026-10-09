// Re-bound diagnostic data before it crosses the main-process boundary.
const MAX_LABELS = 16
const MAX_LABEL_LENGTH = 120
const schema = 'harness.behavior-probe/v1' // shipped diagnostic protocol

export function normalizeProbeResult(name, raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const out = { schema, control: name, viewport: numberPair(source.viewport) }
  for (const [key, value] of Object.entries(source)) {
    if (key === 'control' || key === 'viewport') continue
    if (Number.isFinite(value)) out[key] = value
    else if (Array.isArray(value)) out[key] = value.slice(0, MAX_LABELS).map(entry)
  }
  return out
}

function numberPair(value) {
  const w = Number(value?.w)
  const h = Number(value?.h)
  return { w: Number.isFinite(w) ? w : -1, h: Number.isFinite(h) ? h : -1 }
}

function entry(value) {
  if (typeof value === 'string') return value.slice(0, MAX_LABEL_LENGTH)
  if (!value || typeof value !== 'object') return {}
  const out = {}
  for (const key of ['label', 'selector', 'tag', 'role', 'testid', 'ariaLabel', 'title', 'popup']) {
    if (typeof value[key] === 'string') out[key] = value[key].slice(0, MAX_LABEL_LENGTH)
  }
  for (const key of ['matches', 'total', 'visible', 'usable']) {
    if (Number.isFinite(value[key])) out[key] = value[key]
  }
  for (const key of ['submenu', 'visible', 'expanded', 'disabled']) {
    if (typeof value[key] === 'boolean') out[key] = value[key]
  }
  return out
}
