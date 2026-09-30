import { createChatGPTRecoveryContinuation } from './continuation.mjs'
import { createChatGPTRecoveryAction } from './action.mjs'

export function createChatGPTRecoveryActions(context) {
  const operations = { ...context, ...createChatGPTRecoveryContinuation(context) }
  Object.assign(operations, createChatGPTRecoveryAction(operations))
  return operations
}
