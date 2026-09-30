import { buildBundleName } from '../../../transport/bundlename.mjs'

// Old checkpoints still name a JSON artifact, but new plans use a response
// bundle whose request id belongs to the Orchestrator rather than a chat.
export function orchestratorPlanFilename(taskID) {
  const id = String(taskID || '').trim()
  if (!/^cat_[a-f0-9]{20}$/.test(id)) throw new Error('invalid orchestrator planning task id')
  return `whx_orchestrator_plan_${id}.json`
}

export function orchestratorBundleFilename(requestID) {
  const id = String(requestID || '').trim()
  if (!/^orp_[0-9]{8}T[0-9]{6}_[0-9a-f]{16}$/.test(id)) throw new Error('invalid orchestrator request id')
  return buildBundleName('res', 'orchestrator', id)
}

export function orchestratorDeliveryFor(checkpointFilename) {
  return String(checkpointFilename || '').endsWith('.json') ? 'json' : 'bundle'
}
