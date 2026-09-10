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
  revision: '2026-09-10.1',
  origin: 'builtin',
  baseURL: 'https://chatgpt.com',
  trustedHosts: ['chatgpt.com'],
  conversationPath: '/c/',
  newConversationPath: '/',
  selectors: {
    composer: ['#prompt-textarea', 'div[contenteditable="true"][role="textbox"]', 'textarea[name="prompt-textarea"]'],
    sendButton: ['button[data-testid="send-button"]'],
    stopButton: ['button[data-testid="stop-button"]', 'button[aria-label*="stop generating" i]'],
    assistantTurn: ['[data-message-author-role="assistant"]'],
    conversationTurn: ['[data-testid^="conversation-turn"]'],
    sidebarRoot: ['[data-testid="sidebar"]', 'nav[data-testid*="sidebar"]', 'aside[data-testid*="sidebar"]'],
    sidebarClose: ['button[data-testid="close-sidebar-button"]'],
    sidebarOpen: ['button[data-testid="open-sidebar-button"]'],
    conversationAnchor: ['a[href^="/c/"]'],
    conversationOptionsTrigger: ['[data-conversation-options-trigger]'],
    conversationOptionsHeader: ['button[data-testid="conversation-options-button"]'],
    menuItem: ['[role="menuitem"]'],
    projectAnchor: ['a[role="menuitem"][href^="/g/g-p-"]', 'a[href^="/g/g-p-"]'],
    titleEditor: ['input[name="title-editor"]', 'input[aria-label="Chat title"]'],
    dialog: ['[role="dialog"]'],
    libraryRow: ['div[role="row"][data-page-table-selection-id]'],
    libraryRowActions: ['button[aria-label^="Open actions menu for "]'],
    errorNotice: ['[data-testid*="error" i]', 'div[role="alert"]'],
  },
  // Controls that some accounts/rollouts simply do not render. They are declared
  // separately from `selectors` because an empty list here is a legitimate state
  // ("this account has no model picker"), whereas an empty required selector is
  // a broken document. An unmapped optional control makes its verb report
  // `capability-unavailable` instead of clicking something adjacent, and is the
  // data gap the behavior-evolution pass is meant to fill.
  optionalSelectors: {
    modelPicker: [],
    modelOption: ['[role="menuitem"]', '[role="menuitemradio"]', '[role="option"]'],
    effortPicker: [],
    effortOption: ['[role="menuitem"]', '[role="menuitemradio"]', '[role="option"]'],
  },
  // Menu labels are UI chrome, not user content. They are matched exactly first,
  // then by prefix, and always case-folded.
  labels: {
    rename: ['rename', 'renomear', 'cambiar nombre', 'renommer', 'umbenennen'],
    archive: ['archive', 'arquivar', 'archivar', 'archiver', 'archivieren'],
    delete: ['delete', 'apagar', 'eliminar', 'supprimer', 'löschen'],
    moveToProject: ['move to project', 'mover para projeto', 'mover para o projeto', 'mover al proyecto', 'déplacer vers le projet', 'in projekt verschieben'],
    newProject: ['new project', 'novo projeto', 'nuevo proyecto', 'nouveau projet', 'neues projekt'],
  },
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

  if (errors.length) return { ok: false, errors, behavior: undefined }
  return {
    ok: true,
    errors: [],
    behavior: Object.freeze({
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
  return validateBehavior({
    ...base,
    ...('timing' in overlay ? { timing: { ...base.timing, ...overlay.timing } } : {}),
    selectors,
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
    if (!parsed.pathname.startsWith(behavior.conversationPath)) return ''
    const id = parsed.pathname.slice(behavior.conversationPath.length).split('/')[0]
    // ChatGPT's transient creation URLs (`/c/WEB:...`) are not durable ids.
    return /^[A-Za-z0-9-]{8,128}$/.test(id) && !id.includes(':') ? id : ''
  } catch { return '' }
}
