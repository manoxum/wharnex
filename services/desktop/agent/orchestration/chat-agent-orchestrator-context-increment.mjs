// Partial context for an Orchestrator planning request (adr/ADR-0083). A
// planning answer may be a context-request.json instead of plan.json; the
// backend validates the requested paths against the captured snapshot and
// returns the cumulative selection. The Worker then asks again, in the same
// conversation, with the same request identity and the selected file bodies.
//
// The answer to a context request and the final plan share one canonical
// result filename, so every card from an earlier turn names the expected file
// too. After an increment only a card from a turn newer than the resubmission
// may count, or the poller re-downloads the context request it already
// answered and the Worker loops on it.

// Returns the cumulative selection when it grants at least one file the
// planner has not received yet, null for a re-import that adds nothing, and
// undefined when the import was not a context increment at all.
export function orchestratorContextIncrementPaths(imported, currentPaths) {
  if (imported?.delivery_status !== 'context_increment' || !Array.isArray(imported.context_paths)) return undefined
  const next = imported.context_paths.map((value) => String(value))
  const known = new Set((Array.isArray(currentPaths) ? currentPaths : []).map((value) => String(value)))
  return next.some((value) => !known.has(value)) ? next : null
}

// Re-arms one expected download so it resolves only for an artifact from a
// turn after `assistantBaseline`.
export function rearmOrchestratorPlanDownload(expected, assistantBaseline, now = Date.now()) {
  const download = new Promise((resolve, reject) => { expected.resolve = resolve; expected.reject = reject })
  download.catch(() => undefined)
  expected.armedAt = now
  expected.assistantBaseline = assistantBaseline
  expected.lastClickAt = 0
  expected.downloadStarted = false
  expected.freshOnly = true
  return download
}

// Sends one context increment. `runtime` carries the transport the Worker
// already owns for this conversation; nothing here navigates.
export async function sendOrchestratorContextIncrement(runtime, expected, paths) {
  const captured = await runtime.fetchContext()
  const request = await runtime.writeRequest({ ...captured, mode: 'partial', paths })
  await runtime.persistRequest().catch((error) => runtime.warn(`context increment archive not persisted: ${error instanceof Error ? error.message : String(error)}`))
  await runtime.pace()
  if (!(await runtime.fill(request.bootstrap, 'orchestrator-context-fill'))) {
    throw new Error('ChatGPT orchestrator composer unavailable for context increment')
  }
  await runtime.attach()
  await runtime.fill(request.bootstrap, 'orchestrator-context-refill')
  const assistantBaseline = await runtime.assistantCount()
  const download = rearmOrchestratorPlanDownload(expected, assistantBaseline)
  await runtime.submit()
  await runtime.checkpoint({ assistant_baseline: assistantBaseline, submitted_at: new Date().toISOString(), context_paths: paths })
  return { assistantBaseline, download }
}
