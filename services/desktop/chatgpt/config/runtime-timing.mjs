// A dead file card remains visible after ChatGPT discards the artifact.
// Retire the conversation's stale artifact evidence after this interval.
export const EXPIRED_ARTIFACT_TTL_MS = 10 * 60_000

export const RETRYABLE_PROMPT_TTL_MS = 10 * 60 * 1000
// Keep the delivered tombstone at least as long as the retry affordance.
export const DELIVERED_BUNDLE_DEDUP_TTL_MS = RETRYABLE_PROMPT_TTL_MS
export const EXPECTED_BUNDLE_TTL_MS = 60 * 60 * 1000
export const DOM_DOWNLOAD_POLL_MS = 2_000
export const DOM_DOWNLOAD_RETRY_MS = 5_000
// A click without Chromium's will-download event must not wedge an expectation.
export const DOWNLOAD_INFLIGHT_TIMEOUT_MS = 20_000

export const BUNDLE_COMPLETION_GRACE_MS = 4_000
export const BUNDLE_CONTINUATION_BASE_MS = 5_000
// Completion can be transient between reasoning steps and file-card mounting.
export const BUNDLE_COMPLETION_CONFIRM_MS = 15_000
export const MAX_BUNDLE_CONTINUATIONS = 3
// Automatic delivery recovery gets one wake-up; artifact re-requests use the
// broader continuation budget above.
export const MAX_AUTOMATIC_BUNDLE_CONTINUATIONS = 1
export const PROCESSING_SIGNAL_GRACE_MS = 15_000
// Without an observed generating indicator, a static page proves less than a
// stopped turn. Allow the longer settle window before concluding it ended.
export const BUNDLE_UNOBSERVED_SETTLE_MS = 3 * 60_000
export const CONVERSATION_TRANSPORT_STALE_MS = 30_000
export const PROCESSING_STALE_ATTENTION_MS = 2 * 60_000
// Passive probes do not spend attempts; a page with no structural signal still
// needs an independent, evidence-based bound before human attention is raised.
export const AWAIT_STALL_ATTENTION_MS = 3 * 60_000

export const CHATGPT_RATE_LIMIT_BACKOFF_MS = 7.5 * 60_000
export const CHATGPT_RATE_LIMIT_HEALTHY_WINDOW_MS = 15 * 60_000
export const CHATGPT_DOM_PROBE_FAILURE_LIMIT = 3
export const CHATGPT_ACCOUNT_ACTION_SETTLE_MS = 350
// A trusted options-trigger click does not prove the menu opened under load.
export const CHATGPT_MENU_REOPEN_ATTEMPTS = 3
// Radix reconciles its open state against pointerup after pointerdown.
export const CHATGPT_CONTROL_PRESS_HOLD_MS = 90
export const DEFERRED_SUPERVISOR_NAVIGATION_RETRY_MS = 250
