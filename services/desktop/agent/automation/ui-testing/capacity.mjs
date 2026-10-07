// Process-wide count of UI test runs in flight. A run holds a persistent
// Worker for minutes (its ChatGPT conversation plus the ephemeral browser
// under test) and spends one provider upload per exchange, so the Worker pool
// stops claiming UI_TEST_RUN at this cap and the excess stays queued in the
// durable queue without spending attempts. One run at a time keeps the other
// Workers free for Orchestrator and lifecycle work and the upload budget
// bounded.
export const UI_TEST_RUN_CONCURRENCY = 1

let active = 0

export const uiTestRunSlots = {
  // Several Worker loops can claim before any run has entered, so the
  // executor is the authority: tryEnter refuses above the cap and the task
  // returns to the queue as a free observation.
  tryEnter() { if (active >= UI_TEST_RUN_CONCURRENCY) return false; active += 1; return true },
  leave() { active = Math.max(0, active - 1) },
  active() { return active },
  excludedTypes() { return active >= UI_TEST_RUN_CONCURRENCY ? ['UI_TEST_RUN'] : [] },
}
