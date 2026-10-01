// The local half of a request submission — fetching its inputs, writing the
// logical ZIP and persisting it for idempotent resend — never touches ChatGPT.
// Persisting a large request, its context, and system artifacts can require
// several sequential backend uploads. One 120-second limit for the entire
// sequence aborted after the first successful upload and exhausted the durable
// write task without ever contacting ChatGPT. Keep the whole preparation
// bounded while allowing those uploads to complete.
export const REQUEST_PREPARATION_TIMEOUT_MS = 10 * 60_000
const SAFE_LOCAL_UPLOAD_PART_BYTES = 12 * 1024 * 1024

export function boundedChatInputPartBytes({ totalBytes, partBytes, partLimit }) {
  const count = Math.max(1, Number(partLimit) || 1)
  const minimumForCount = Math.ceil(Number(totalBytes) / count) + 256 * 1024
  return Math.min(Number(partBytes), Math.max(SAFE_LOCAL_UPLOAD_PART_BYTES, minimumForCount))
}

// Derives a signal that aborts at the deadline or when the parent aborts, and
// remembers which of the two happened so a timeout is never reported as an
// operator cancellation.
export function boundedTransportSignal(parentSignal, timeoutMs) {
  const controller = new AbortController()
  const boundedTimeout = Math.max(1, Math.trunc(Number(timeoutMs) || 0))
  let deadlineReached = false
  const abortFromParent = () => controller.abort(parentSignal?.reason)
  const timer = setTimeout(() => {
    deadlineReached = true
    controller.abort(new Error('Request preparation timed out'))
  }, boundedTimeout)
  if (parentSignal) {
    if (parentSignal.aborted) abortFromParent()
    else parentSignal.addEventListener('abort', abortFromParent, { once: true })
  }
  return {
    signal: controller.signal,
    timedOut: () => deadlineReached,
    dispose: () => {
      clearTimeout(timer)
      parentSignal?.removeEventListener('abort', abortFromParent)
    },
  }
}

export async function withRequestPreparationDeadline(parentSignal, operation, { timeoutMs = REQUEST_PREPARATION_TIMEOUT_MS } = {}) {
  const deadline = boundedTransportSignal(parentSignal, timeoutMs)
  try {
    return await operation(deadline.signal)
  } catch (error) {
    if (!deadline.timedOut()) throw error
    throw new Error(`A preparação local do bundle excedeu ${Math.round(timeoutMs / 1000)} segundos; a tarefa será repetida sem ter contactado o ChatGPT.`)
  } finally {
    deadline.dispose()
  }
}

// One timestamped line per phase. The Desktop log carries no timestamps of its
// own, so without these a slow request can only be reconstructed by
// correlating gateway access logs.
export function requestPreparationTimer(requestId, { log = console.log, now = Date.now } = {}) {
  const startedAt = now()
  let previous = startedAt
  return {
    phase(name, detail = '') {
      const at = now()
      log(`[chatgpt-prepare] at=${new Date(at).toISOString()} request=${requestId || '-'} phase=${name} phaseMs=${at - previous} totalMs=${at - startedAt}${detail ? ` ${detail}` : ''}`)
      previous = at
    },
  }
}
