import { createAccountControls } from '../control/index.mjs'
import { createAccountProject } from '../project/ensure.mjs'
import { createAccountConversations } from '../conversation/index.mjs'
import { createAccountLibraryDelete } from '../library/delete.mjs'

export function createChatGPTAccountOperations(context) {
  const operations = createAccountControls({ ...context })
  Object.assign(operations, createAccountProject(operations))
  createAccountConversations(operations)
  Object.assign(operations, createAccountLibraryDelete(operations))
  return operations
}
