import { createChatAgentCapacityAvailability } from './capacity/index.mjs'
import { createChatAgentAutoScaleRuntime } from './capacity/index.mjs'
import { createChatAgentWorkerPool } from './residency/index.mjs'

export function createChatAgentSchedulingOperations(options) {
  const workers = createChatAgentWorkerPool(options)
  const availability = createChatAgentCapacityAvailability({ ...options, ...workers })
  const autoScale = createChatAgentAutoScaleRuntime({ ...options, ...availability })
  return { ...workers, ...availability, ...autoScale }
}
