// Process-wide count of UI test runs in flight. Each run holds two Chromium
// surfaces (its ChatGPT conversation and the browser under test) for minutes,
// unlike the short artifact jobs the ephemeral pool was sized for, so the
// ephemeral consumer stops claiming UI_TEST_RUN at this soft cap. The excess
// stays queued in the durable queue without spending attempts.
export const UI_TEST_RUN_CONCURRENCY = 3

let active = 0

export const uiTestRunSlots = {
  // Claims race at startup (every loop claims before any run has entered), so
  // the executor is the authority: tryEnter refuses above the cap and the task
  // returns to the queue as a free observation.
  tryEnter() { if (active >= UI_TEST_RUN_CONCURRENCY) return false; active += 1; return true },
  enter() { active += 1 },
  leave() { active = Math.max(0, active - 1) },
  active() { return active },
  excludedTypes() { return active >= UI_TEST_RUN_CONCURRENCY ? ['UI_TEST_RUN'] : [] },
}
