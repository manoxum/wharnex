// A Worker can resume after the answer is already in the conversation. Its
// saved assistant count may then equal the live count, so the exact artifact
// affordance must be probed independently of that count, as the Supervisor does.
export const WORKER_DOWNLOAD_RETRY_MS = 20_000

export async function pollWorkerExpectedDownload(expected, execute, script, now = Date.now()) {
  if (expected.downloadStarted) return ''
  if (expected.lastClickAt && now - expected.lastClickAt < WORKER_DOWNLOAD_RETRY_MS) return ''
  const mode = await execute(script(expected.filename, expected.assistantBaseline))
  if (mode) expected.lastClickAt = now
  return mode || ''
}
