import { createPromptContinuation } from './continue.mjs'

export function createPromptContinuationOperations(context) {
  Object.assign(context, createPromptContinuation(context))
  return context
}
