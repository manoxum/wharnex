import { createManualPromptAttachments } from './attach.mjs'

export function createManualPromptOperations(context) {
  Object.assign(context, createManualPromptAttachments(context))
  return context
}
