import { createPromptPreparationOperations } from './preparation/index.mjs'
import { createPromptRetryOperations } from './retry/index.mjs'
import { createManualPromptOperations } from './manual/index.mjs'
import { createPromptSubmissionOperations } from './submission/index.mjs'
import { createPromptContinuationOperations } from './continuation/index.mjs'

export function createChatGPTPromptTransport(context) {
  const operations = createPromptPreparationOperations({ ...context })
  createPromptRetryOperations(operations)
  createManualPromptOperations(operations)
  createPromptSubmissionOperations(operations)
  createPromptContinuationOperations(operations)
  return operations
}
