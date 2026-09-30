import { createPreparedPromptSubmission } from './prepared.mjs'
import { createPromptSubmission } from './prompt.mjs'
export { createChatGPTDraftSubmission } from './draft.mjs'

export function createPromptSubmissionOperations(context) {
  Object.assign(context, createPreparedPromptSubmission(context))
  Object.assign(context, createPromptSubmission(context))
  return context
}
