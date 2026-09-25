// The live route is an optional acceleration for the mandatory request ZIP.
// A stalled tunnel must never prevent that ZIP from reaching ChatGPT.
export function remoteInputPublicationSignal(parentSignal, timeoutMs) {
  const controller = new AbortController()
  const boundedTimeout = Math.max(1, Math.trunc(Number(timeoutMs) || 0))
  let deadlineReached = false
  const abortFromParent = () => controller.abort(parentSignal?.reason)
  const timer = setTimeout(() => {
    deadlineReached = true
    controller.abort(new Error('Remote input publication timed out'))
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
