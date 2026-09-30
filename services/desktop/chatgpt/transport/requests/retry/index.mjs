import { createPersistedPromptRetry } from './persisted.mjs'
import { createPreparedPromptRetry } from './prepared.mjs'

export function createPromptRetryOperations(context) {
  Object.assign(context, createPersistedPromptRetry(context))
  Object.assign(context, createPreparedPromptRetry(context))
  return context
}
