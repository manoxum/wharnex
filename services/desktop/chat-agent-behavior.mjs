import { CHATGPT_DOM_BEHAVIOR_REVISION, CHATGPT_EFFORT_LEVELS, CHATGPT_OPTIONAL_SELECTORS, CHATGPT_REQUIRED_SELECTORS } from './chatgpt-behavior-dom-map.mjs'

// Materialized behavior for a chat-provider agent.
//
// An agent owns *how to drive a browser instance*; this document owns *what to
// drive in it*. Keeping the two apart is what lets a second provider be added
// by shipping another behavior document instead of another agent, and lets a
// ChatGPT UI change be absorbed by updating a document rather than editing
// control flow.
//
// The base document below is the source of truth in code. A learned overlay may
// refine it at runtime (see `mergeBehavior`), but only for the fields the schema
// admits, and always with provenance so a bad overlay can be traced and dropped.

export const BEHAVIOR_SCHEMA = 'harness.chat-agent-behavior/v1'

// Every selector list is ordered: earlier entries are preferred, later entries
// are fallbacks. A list is never empty, so a UI change degrades to "no candidate
// matched" — a reportable anomaly — instead of an undefined lookup.
export const CHATGPT_BEHAVIOR = Object.freeze({
  schema: BEHAVIOR_SCHEMA,
  provider: 'chatgpt',
  // 2026-09-25: the definitive-chat composer separates media inputs from the
  // general-file input and renders a ZIP as an indeterminate preview spinner.
  // Upload observation remains composer-local and never reads preview/prompt
  // text; see chatgpt-upload.mjs and chatgpt-upload-observation.mjs.
  revision: CHATGPT_DOM_BEHAVIOR_REVISION,
  origin: 'builtin',
  baseURL: 'https://chatgpt.com',
  trustedHosts: ['chatgpt.com'],
  conversationPath: '/c/',
  newConversationPath: '/',
  selectors: CHATGPT_REQUIRED_SELECTORS,
  // Controls that some accounts/rollouts simply do not render. They are declared
  // separately from `selectors` because an empty list here is a legitimate state
  // ("this account has no model picker"), whereas an empty required selector is
  // a broken document. An unmapped optional control makes its verb report
  // `capability-unavailable` instead of clicking something adjacent, and is the
  // data gap the behavior-evolution pass is meant to fill.
  optionalSelectors: CHATGPT_OPTIONAL_SELECTORS,
  // Visible reasoning capture. ChatGPT renders short activity summaries above
  // the answer ("Validou estilos e temas da interface"). Those are useful; the
  // tool/code blocks interleaved with them are not, and are excluded
  // structurally rather than by reading what they say.
  reasoning: {
    enabled: true,
    maxRows: 40,
    maxRowChars: 240,
    minRowChars: 8,
    excludeWithin: ['pre', 'code', '.markdown', '[data-message-author-role]'],
  },
  // Menu labels are UI chrome, not user content. They are matched exactly first,
  // then by prefix, and always case-folded.
  labels: {
    rename: ['rename', 'renomear', 'cambiar nombre', 'renommer', 'umbenennen'],
    archive: ['archive', 'arquivar', 'archivar', 'archiver', 'archivieren'],
    delete: ['delete', 'apagar', 'eliminar', 'supprimer', 'löschen'],
    moveToProject: ['move to project', 'mover para projeto', 'mover para o projeto', 'mover al proyecto', 'déplacer vers le projet', 'in projekt verschieben'],
    newProject: ['new project', 'novo projeto', 'nuevo proyecto', 'nouveau projet', 'neues projekt'],
    // The collapsed reasoning disclosure. Matched by prefix because the label
    // carries a duration ("Processou durante 5m 23s").
    reasoningDisclosure: ['processou durante', 'pensou durante', 'thought for', 'reasoned for', 'thinking for', 'razonó durante', 'a réfléchi pendant'],
  },
  // Reasoning-effort levels observed on the composer slider, weakest to
  // strongest. Do not invent intermediate levels: the September 2026 captured
  // surfaces expose exactly these three stops.
  effortLevels: CHATGPT_EFFORT_LEVELS,
  timing: {
    settleMs: 350,
    menuSettleMs: 400,
    navigationTimeoutMs: 45_000,
    readyTimeoutMs: 30_000,
    sendConfirmTimeoutMs: 25_000,
    inspectTimeoutMs: 20_000,
    retryBaseMs: 500,
    retryCeilingMs: 8_000,
    maxAttempts: 4,
  },
  // A job is only complete when its own evidence says so. These are the
  // conditions each verb must positively observe before reporting success.
  verification: {
    navigate: { requireTrustedHost: true, requireConversationURL: true, requireReadySelector: 'composer' },
    send: { requireComposerCleared: true, requireConversationRequest: true, requireAssistantProgress: true },
    inspect: { requireReadySelector: 'composer' },
  },
  anomaly: {
    captureSelectors: ['main', '[role="dialog"]', '[role="alert"]'],
    maxCaptureBytes: 262_144,
    escalateAfterRepeats: 3,
  },
})

const SELECTOR_KEYS = Object.keys(CHATGPT_BEHAVIOR.selectors)
const OPTIONAL_SELECTOR_KEYS = Object.keys(CHATGPT_BEHAVIOR.optionalSelectors)
const LABEL_KEYS = Object.keys(CHATGPT_BEHAVIOR.labels)
const TIMING_KEYS = Object.keys(CHATGPT_BEHAVIOR.timing)

function selectorList(value) {
  const list = (Array.isArray(value) ? value : [value])
    .map((entry) => String(entry || '').trim())
    .filter((entry) => entry.length > 0 && entry.length <= 400)
  return [...new Set(list)].slice(0, 12)
}

/**
 * Validates a behavior document. Returns `{ ok, errors, behavior }`. Validation
 * is total: an invalid document is never partially applied, because a half-valid
 * overlay is indistinguishable at runtime from a UI that changed shape.
 */
export function validateBehavior(candidate) {
  const errors = []
  const value = candidate && typeof candidate === 'object' ? candidate : {}
  if (value.schema !== BEHAVIOR_SCHEMA) errors.push(`schema must be ${BEHAVIOR_SCHEMA}`)
  if (!String(value.provider || '').trim()) errors.push('provider is required')
  if (!String(value.revision || '').trim()) errors.push('revision is required')

  const hosts = Array.isArray(value.trustedHosts) ? value.trustedHosts.map((host) => String(host || '').trim().toLowerCase()).filter(Boolean) : []
  if (!hosts.length) errors.push('trustedHosts must list at least one host')

  const selectors = {}
  for (const key of SELECTOR_KEYS) {
    const list = selectorList(value.selectors?.[key] ?? CHATGPT_BEHAVIOR.selectors[key])
    if (!list.length) errors.push(`selectors.${key} must not be empty`)
    selectors[key] = list
  }

  const labels = {}
  for (const key of LABEL_KEYS) {
    const list = (Array.isArray(value.labels?.[key]) ? value.labels[key] : CHATGPT_BEHAVIOR.labels[key])
      .map((entry) => String(entry || '').trim().toLocaleLowerCase())
      .filter(Boolean)
    if (!list.length) errors.push(`labels.${key} must not be empty`)
    labels[key] = [...new Set(list)].slice(0, 24)
  }

  const timing = {}
  for (const key of TIMING_KEYS) {
    const raw = Number(value.timing?.[key] ?? CHATGPT_BEHAVIOR.timing[key])
    // A zero or negative budget would turn a bounded wait into an immediate
    // failure; an unbounded one would hang a slot forever.
    if (!Number.isFinite(raw) || raw <= 0 || raw > 600_000) errors.push(`timing.${key} must be within (0, 600000]`)
    timing[key] = Math.round(raw)
  }

  // Optional controls may legitimately be absent (an account with no model
  // picker), so an empty list here is data, not a defect.
  const optionalSelectors = {}
  for (const key of OPTIONAL_SELECTOR_KEYS) {
    optionalSelectors[key] = selectorList(value.optionalSelectors?.[key] ?? CHATGPT_BEHAVIOR.optionalSelectors[key])
  }

  const effortLevels = (Array.isArray(value.effortLevels) ? value.effortLevels : CHATGPT_BEHAVIOR.effortLevels)
    .map((level) => ({
      id: String(level?.id || '').trim(),
      labels: (Array.isArray(level?.labels) ? level.labels : []).map((entry) => String(entry || '').trim().toLocaleLowerCase()).filter(Boolean),
    }))
    .filter((level) => level.id && level.labels.length)
  if (!effortLevels.length) errors.push('effortLevels must describe at least one level')

  const reasoning = { ...CHATGPT_BEHAVIOR.reasoning, ...(value.reasoning || {}) }
  if (!Array.isArray(reasoning.excludeWithin) || !reasoning.excludeWithin.length) {
    // Without an exclusion set the extractor would pull code blocks into the
    // visible-reasoning panel, which is exactly what it must not do.
    errors.push('reasoning.excludeWithin must not be empty')
  }

  if (errors.length) return { ok: false, errors, behavior: undefined }
  return {
    ok: true,
    errors: [],
    behavior: Object.freeze({
      optionalSelectors: Object.freeze(optionalSelectors),
      effortLevels: Object.freeze(effortLevels),
      reasoning: Object.freeze(reasoning),
      schema: BEHAVIOR_SCHEMA,
      provider: String(value.provider).trim(),
      revision: String(value.revision).trim(),
      origin: String(value.origin || 'builtin'),
      baseURL: String(value.baseURL || CHATGPT_BEHAVIOR.baseURL),
      trustedHosts: hosts,
      conversationPath: String(value.conversationPath || CHATGPT_BEHAVIOR.conversationPath),
      newConversationPath: String(value.newConversationPath || CHATGPT_BEHAVIOR.newConversationPath),
      selectors: Object.freeze(selectors),
      labels: Object.freeze(labels),
      timing: Object.freeze(timing),
      verification: Object.freeze({ ...CHATGPT_BEHAVIOR.verification, ...(value.verification || {}) }),
      anomaly: Object.freeze({ ...CHATGPT_BEHAVIOR.anomaly, ...(value.anomaly || {}) }),
    }),
  }
}

/**
 * Applies a learned overlay onto a base document.
 *
 * An overlay may only *extend* selector lists and adjust timings — it can never
 * remove a builtin selector. A UI change should add a new way to find a control,
 * not delete the way that still works for users on an older rollout, and an
 * overlay that could delete selectors would let one bad learning cycle blind the
 * agent permanently.
 */
export function mergeBehavior(base, overlay) {
  if (!overlay || typeof overlay !== 'object') return validateBehavior(base)
  const selectors = {}
  for (const key of SELECTOR_KEYS) {
    const learned = selectorList(overlay.selectors?.[key] ?? [])
    // Learned candidates go first: they were observed on the page that is
    // actually loaded, while builtins are retained as the durable fallback.
    selectors[key] = selectorList([...learned, ...(base.selectors?.[key] || [])])
  }
  // Optional controls are where learning matters most: an unmapped model or
  // reasoning control is exactly the gap an evolution pass is meant to close.
  const optionalSelectors = {}
  for (const key of OPTIONAL_SELECTOR_KEYS) {
    optionalSelectors[key] = selectorList([...selectorList(overlay.optionalSelectors?.[key] ?? []), ...(base.optionalSelectors?.[key] || [])])
  }

  return validateBehavior({
    ...base,
    ...('timing' in overlay ? { timing: { ...base.timing, ...overlay.timing } } : {}),
    selectors,
    optionalSelectors,
    labels: { ...base.labels, ...(overlay.labels || {}) },
    revision: String(overlay.revision || base.revision),
    origin: overlay.origin ? String(overlay.origin) : 'learned',
  })
}

export function baseBehavior(provider = 'chatgpt') {
  if (provider !== 'chatgpt') throw new Error(`No builtin chat-agent behavior for provider ${provider}`)
  const validated = validateBehavior(CHATGPT_BEHAVIOR)
  if (!validated.ok) throw new Error(`Builtin behavior is invalid: ${validated.errors.join('; ')}`)
  return validated.behavior
}

export function isTrustedBehaviorURL(behavior, url) {
  try {
    const parsed = new URL(String(url || ''))
    if (parsed.protocol !== 'https:') return false
    const host = parsed.hostname.toLowerCase()
    return behavior.trustedHosts.some((trusted) => host === trusted || host.endsWith(`.${trusted}`))
  } catch { return false }
}

export function conversationIdFromURL(behavior, url) {
  try {
    const parsed = new URL(String(url || ''))
    if (!isTrustedBehaviorURL(behavior, parsed.href)) return ''
    // A conversation inside a project is served from `/g/g-p-<project>/c/<id>`,
    // so the conversation segment is matched wherever it appears rather than
    // only at the root of the path.
    const segment = behavior.conversationPath.replace(/^\/|\/$/g, '')
    const id = new RegExp(`(?:^|/)${segment}/([^/?#]+)`).exec(parsed.pathname)?.[1] || ''
    // ChatGPT's transient creation URLs (`/c/WEB:...`) are not durable ids.
    return /^[A-Za-z0-9-]{8,128}$/.test(id) && !id.includes(':') ? id : ''
  } catch { return '' }
}
