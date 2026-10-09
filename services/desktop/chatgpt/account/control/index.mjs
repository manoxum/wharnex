import { createAccountScript } from './script.mjs'
import { createAccountViewport } from './viewport.mjs'
import { createAccountInput } from './input.mjs'
import { createAccountActions } from './actions.mjs'
import { createAccountSidebar } from './sidebar.mjs'

export function createAccountControls(context) {
  Object.assign(context, createAccountScript(context))
  Object.assign(context, createAccountViewport(context))
  Object.assign(context, createAccountInput(context))
  Object.assign(context, createAccountActions(context))
  Object.assign(context, createAccountSidebar(context))
  return context
}

export { withOwnedChatGPTPageInput } from './page-input.mjs'
