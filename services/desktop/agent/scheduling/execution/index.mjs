import { createAccountLifecycleExecutor } from './account-lifecycle.mjs'
import { createChatAgentTaskDispatcher } from './dispatcher.mjs'

export function createChatAgentExecution(context) {
  const operations = { ...context, ...createAccountLifecycleExecutor(context) }
  Object.assign(operations, createChatAgentTaskDispatcher(operations))
  return operations
}
