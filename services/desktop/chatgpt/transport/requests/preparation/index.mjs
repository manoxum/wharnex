import { createPromptPreparation } from './prepare.mjs'
import { createPromptQueue } from './queue.mjs'
export { createChatInputPreparation } from './input.mjs'

export function createPromptPreparationOperations(context) {
  Object.assign(context, createPromptPreparation(context))
  Object.assign(context, createPromptQueue(context))
  return context
}
