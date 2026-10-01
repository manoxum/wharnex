// Provider-wide ChatGPT rate-limit evidence.
//
// Two conditions wear the same HTTP status: one throttled request and the
// account-wide block ChatGPT renders in its surface. Both stop the whole
// automation for the same fixed seven-and-a-half-minute window; retaining the distinction
// still explains whether the evidence came from transport or the structural
// gate without allowing the shorter old retry ladder to recreate a storm.
//
// The signals below are deliberately structural. The gate is recognised by the
// shape of the evidence (which endpoint, how many refusals, which control
// ChatGPT exposed), never by reading localized status prose.

export const RATE_LIMIT_TRANSPORT = 'transport'
export const RATE_LIMIT_GATE = 'gate'

// How much refusal, over how long, stops being one throttled call and becomes
// account-wide pressure. Two inside two minutes is the shape a submission burst
// produces; a lone 429 during normal traffic is not.
export const RATE_LIMIT_GATE_WINDOW_MS = 2 * 60_000
export const RATE_LIMIT_GATE_HITS = 2

// Attribute patterns for ChatGPT's own rate-limit affordance. A closed enum of
// structural selectors: it matches on what the control *is*, so it works in
// every interface language and never inspects assistant or status text.
export const RATE_LIMIT_GATE_SELECTORS = Object.freeze([
  '[data-testid*="rate-limit" i]',
  '[data-testid*="rate_limit" i]',
  '[data-testid*="too-many" i]',
  '[data-testid*="too_many" i]',
  '[data-testid*="usage-limit" i]',
  '[data-testid*="limit-reached" i]',
  '[data-testid*="message-cap" i]',
])

/**
 * True for any trusted ChatGPT backend API request.
 *
 * The narrow conversation-transport predicate was the hole this incident fell
 * through: ChatGPT refuses a burst on whichever backend endpoint the submission
 * happens to use, and a 429 on a sibling endpoint carried exactly the same
 * meaning for the account while being ignored entirely.
 */
export function isChatGPTBackendAPIURL(value) {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol !== 'https:') return false
    if (url.hostname !== 'chatgpt.com' && !url.hostname.endsWith('.chatgpt.com')) return false
    return url.pathname.startsWith('/backend-api/')
  } catch { return false }
}

/**
 * Fold one new refusal into the recent-hit window and say what it amounts to.
 *
 * Pure so the escalation rule is testable without a provider: callers keep the
 * returned `hits` array and pass it back on the next refusal.
 */
export function classifyChatGPTRateLimit(hits, options = {}) {
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now()
  const windowMs = boundedPositive(options.windowMs, RATE_LIMIT_GATE_WINDOW_MS)
  const burstHits = Math.max(2, Number(options.burstHits) || RATE_LIMIT_GATE_HITS)
  const domGate = options.domGate === true

  const recent = (Array.isArray(hits) ? hits : [])
    .map((at) => Number(at))
    .filter((at) => Number.isFinite(at) && at <= now && now - at < windowMs)
  recent.push(now)

  // ChatGPT showing the control itself is conclusive on its own: there is no
  // reading of it as "one slow request".
  const kind = domGate || recent.length >= burstHits ? RATE_LIMIT_GATE : RATE_LIMIT_TRANSPORT
  return { kind, hits: recent, recentHits: recent.length, domGate }
}

function boundedPositive(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}
