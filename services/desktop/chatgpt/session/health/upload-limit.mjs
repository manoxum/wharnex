import { composerLookupSource } from '../../dom/chatgpt-composer-lookup.mjs'

// Account-wide ChatGPT file-upload limit.
//
// ChatGPT caps file uploads per account over a rolling window. Once the cap is
// spent the composer still accepts the native file selection, but no upload
// request ever leaves the page: every attempt ends as "did not start", each one
// retried five times locally, by every pool, until each task's attempt budget
// is gone. Observed 2026-10-05/06: 1290 such retries against 333 real uploads.
//
// The gate turns that into one bounded, attempt-free wait:
// - two consecutive "did not start" outcomes with no confirmed upload between
//   them (from any surface), or one with structural evidence, open the gate;
// - while it is open every upload-bound action defers before file selection;
// - when the window lapses exactly one upload is admitted as the probe — its
//   success closes the gate, its failure reopens it at the next, wider window;
// - any confirmed upload, an account change or an operator release closes it.
// The limit belongs to the account, never to a request, so nothing here reads
// page text: evidence is the absence of the upload, plus structural state.

export const UPLOAD_LIMIT_WINDOWS_MS = [10, 20, 40, 80, 120].map((minutes) => minutes * 60_000)
export const UPLOAD_LIMIT_PROBE_WAIT_MS = 60_000
const PROBE_LEASE_MS = 5 * 60_000
const OPENING_FAILURES = 2

export class ChatGPTUploadLimitDeferral extends Error {
  constructor(delayMs) {
    super('ChatGPT account file-upload limit is active')
    this.name = 'ChatGPTUploadLimitDeferral'
    this.delayMs = Math.max(1_000, Number(delayMs) || 0)
    this.retryUpload = false
    this.uploadLimit = true
    // Nothing reached ChatGPT: the task comes back as a free observation.
    this.freeDeferral = true
  }
}

export function createChatGPTUploadLimitGate({ now = Date.now, persist = () => {}, log = console.log } = {}) {
  const state = { until: 0, level: 0, failures: 0, probeOwner: '', probeSince: 0, reason: '', changedAt: 0 }

  const windowFor = (level) => UPLOAD_LIMIT_WINDOWS_MS[Math.min(UPLOAD_LIMIT_WINDOWS_MS.length, Math.max(1, level)) - 1]

  function open(level, reason) {
    state.level = level
    state.until = now() + windowFor(level)
    state.failures = 0
    state.probeOwner = ''
    state.reason = reason
    state.changedAt = now()
    log(`[chatgpt-upload-limit] opened level=${level} until=${new Date(state.until).toISOString()} reason=${reason}`)
    persist(snapshot())
  }

  function close(reason) {
    const wasOpen = state.level > 0
    Object.assign(state, { until: 0, level: 0, failures: 0, probeOwner: '', probeSince: 0, reason: '', changedAt: now() })
    if (!wasOpen) return
    log(`[chatgpt-upload-limit] closed reason=${reason}`)
    persist(snapshot())
  }

  // Decides whether an upload may be attempted by owner (a webContents id).
  function admit(owner) {
    const current = now()
    if (state.level === 0) return { allowed: true, probe: false }
    if (current < state.until) return { allowed: false, delayMs: state.until - current }
    const probeLive = state.probeOwner && current - state.probeSince < PROBE_LEASE_MS
    if (probeLive && state.probeOwner !== String(owner)) return { allowed: false, delayMs: UPLOAD_LIMIT_PROBE_WAIT_MS }
    state.probeOwner = String(owner)
    state.probeSince = current
    log(`[chatgpt-upload-limit] probe owner=${owner} level=${state.level}`)
    return { allowed: true, probe: true }
  }

  // Records an upload that never started. Returns the deferral to throw when
  // the gate is (now) open, so the caller stops its local retries at once.
  function noteNotStarted(owner, { structural = false } = {}) {
    if (state.level > 0 && state.probeOwner === String(owner)) {
      open(state.level + 1, 'probe-not-started')
      return new ChatGPTUploadLimitDeferral(state.until - now())
    }
    if (state.level > 0) return new ChatGPTUploadLimitDeferral(Math.max(state.until - now(), UPLOAD_LIMIT_PROBE_WAIT_MS))
    state.failures += 1
    if (!structural && state.failures < OPENING_FAILURES) return null
    open(1, structural ? 'structural-upload-disabled' : 'consecutive-not-started')
    return new ChatGPTUploadLimitDeferral(state.until - now())
  }

  function noteConfirmed() {
    if (state.level > 0) close('upload-confirmed')
    else state.failures = 0
  }

  // Follows the durable hold. An active one is adopted, never shortened (a
  // Desktop restart keeps the window); an inactive one written after this
  // gate last changed is an operator release and closes it. An older inactive
  // record is a read that raced this gate's own persistence and is ignored.
  function adopt(hold) {
    const until = Date.parse(String(hold?.until || ''))
    const updatedAt = Date.parse(String(hold?.updated_at || '')) || 0
    if (hold?.active === true && Number.isFinite(until) && until > now()) {
      if (state.level === 0) log(`[chatgpt-upload-limit] adopted level=${hold.level} until=${hold.until}`)
      state.level = Math.max(state.level, Number(hold.level) || 1)
      state.until = Math.max(state.until, until)
      state.reason = String(hold.reason || state.reason || 'restored')
      state.changedAt = Math.max(state.changedAt, updatedAt || now())
      return
    }
    if (hold?.active === false && state.level > 0 && updatedAt > state.changedAt) close('released')
  }

  function snapshot() {
    return { active: state.level > 0, until: state.level > 0 ? new Date(state.until).toISOString() : null, level: state.level, reason: state.reason }
  }

  return { admit, noteNotStarted, noteConfirmed, release: close, adopt, snapshot }
}

// Structural shape of the composer's upload affordance. It reports only
// whether the controls ChatGPT disables are disabled — never labels or text —
// and the counts that let the maintenance map be refined from the log.
export function chatGPTUploadAffordanceScript() {
  return `(() => {
    ${composerLookupSource()}
    const surface = composer?.closest('[data-composer-surface]') || composer?.closest('form');
    if (!surface) return { found: false };
    const disabled = (node) => Boolean(node && (node.disabled === true || node.getAttribute('aria-disabled') === 'true' || node.hasAttribute('data-disabled')));
    const inputs = [...surface.querySelectorAll('input[type="file"]')];
    const triggers = [...surface.querySelectorAll('button[data-testid*="plus" i],button[data-testid*="attach" i],button[data-testid*="upload" i]')];
    return {
      found: true,
      inputs: inputs.length,
      inputsDisabled: inputs.filter(disabled).length,
      triggers: triggers.length,
      triggersDisabled: triggers.filter(disabled).length,
    };
  })()`
}

export function uploadAffordanceDisabled(shape) {
  if (shape?.found !== true) return false
  const allInputs = shape.inputs > 0 && shape.inputsDisabled === shape.inputs
  const allTriggers = shape.triggers > 0 && shape.triggersDisabled === shape.triggers
  return allInputs || allTriggers
}
