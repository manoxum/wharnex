import { createChatGPTConversationSettlement } from '../../../chatgpt/session/ownership/conversation-settlement.mjs'
import { createDesktopRequestPreparation } from '../preparation/runtime.mjs'
import { createDesktopChatGPTAccount } from '../../../chatgpt/account/wiring/desktop.mjs'
import { createOwnedChatGPTConversationReload } from '../../../chatgpt/session/views/reload.mjs'
import { createChatGPTComposerTarget } from '../../../chatgpt/transport/requests/composer/target.mjs'
import { createDesktopChatGPTPacing } from '../pacing/runtime.mjs'
import { createDesktopPromptDispatch } from '../../../chatgpt/transport/requests/wiring/desktop.mjs'
import { createDesktopChatGPTModels } from '../../../chatgpt/models/index.mjs'

export function createDesktopChatGPTTransportStage(d) {
  const settlement = createChatGPTConversationSettlement(d)
  let pacing
  const request = createDesktopRequestPreparation({
    ...d,
    pasteChatGPTFile: (...args) => pacing.pasteChatGPTFile(...args),
    recoverChatGPTConversationLoadFailure: (...args) => pacing.recoverChatGPTConversationLoadFailure(...args),
  })
  const account = createDesktopChatGPTAccount({
    ...d, ...request,
    paceChatGPTWorkerNavigation: (...args) => pacing.paceChatGPTWorkerNavigation(...args),
  })
  const reload = createOwnedChatGPTConversationReload({
    ...d, ...request, homeURL: d.CHATGPT_URL,
  })
  const target = createChatGPTComposerTarget({ ...d, ...request, ...account })
  pacing = createDesktopChatGPTPacing({ ...d, ...request })
  const models = createDesktopChatGPTModels({ ...d, ...request, ...account })
  const dispatch = createDesktopPromptDispatch({
    ...d, ...settlement, ...request, ...account, ...target, ...pacing, ...models,
  })
  return { ...settlement, ...request, ...account, ...reload, ...target, ...pacing, ...models, ...dispatch }
}
