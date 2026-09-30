import { keepFlowingForWorker } from './chat-agent-policies.mjs'

export function createKeepFlowingState({ policies, workerStates, workerCount, delivered, pendingDeliveries, expectedBundles }) {
  const configured = (worker) => keepFlowingForWorker(policies(), worker)
  const taskEnabled = (task) => task?.keep_flowing === true

  function sponsored(runtime) {
    if (taskEnabled(runtime?.task)) return true
    if (runtime?.error) return false
    return String(runtime?.lastResult?.status || '').toLowerCase() === 'waiting'
      && taskEnabled(runtime?.lastTask)
  }

  function enabled(worker, task) {
    const runtime = workerStates.get(worker)
    return configured(worker) || taskEnabled(runtime?.task) || taskEnabled(task)
  }

  function active(worker) {
    const runtime = workerStates.get(worker)
    const task = runtime?.task || runtime?.lastTask
    // A task sponsorship survives WAITING/re-claim, but terminal results end it.
    if (!configured(worker) && !sponsored(runtime)) return false
    const requestId = String(task?.root_request_id || task?.request_id || '').trim()
    if (['attention', 'failed'].includes(String(runtime?.lastResult?.status || '').toLowerCase())) return false
    if (!requestId || delivered(requestId) || pendingDeliveries.has(requestId)) return false
    for (const expected of expectedBundles.values()) if (expected.requestId === requestId) return true
    return false
  }

  function requestActive(requestId) {
    const id = String(requestId || '').trim()
    if (!id || delivered(id) || pendingDeliveries.has(id)) return false
    for (let worker = 1; worker <= workerCount(); worker += 1) {
      const runtime = workerStates.get(worker)
      const task = runtime?.task || runtime?.lastTask
      if (!configured(worker) && !sponsored(runtime)) continue
      if (String(task?.root_request_id || task?.request_id || '').trim() === id) return true
    }
    return false
  }

  return { configured, taskEnabled, sponsored, enabled, active, requestActive }
}
