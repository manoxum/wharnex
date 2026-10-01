import { createAccountOrganize } from './organize.mjs'
import { createAccountTitle } from './title.mjs'
import { createAccountArchive } from './archive.mjs'
import { createAccountDelete } from './delete.mjs'
import { createAccountStop } from './stop.mjs'

export function createAccountConversations(context) {
  Object.assign(context, createAccountOrganize(context))
  Object.assign(context, createAccountTitle(context))
  Object.assign(context, createAccountArchive(context))
  Object.assign(context, createAccountDelete(context))
  Object.assign(context, createAccountStop(context))
  return context
}
