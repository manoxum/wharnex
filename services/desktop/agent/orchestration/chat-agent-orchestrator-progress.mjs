export function orchestratorCompletionDiagnostic(completion, assistantBaseline, downloadTriggered) {
  const count = Number(completion?.assistantCount)
  const baseline = Number(assistantBaseline)
  return {
    responseStarted: Number.isSafeInteger(count) && Number.isSafeInteger(baseline) && count > baseline,
    complete: completion?.complete === true,
    thinking: completion?.thinking === true,
    failed: completion?.failed === true,
    composerReady: completion?.composerReady === true,
    downloadTriggered: downloadTriggered === true,
  }
}
