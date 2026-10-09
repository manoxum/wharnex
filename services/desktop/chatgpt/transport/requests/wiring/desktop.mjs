import { stepChatGPTEffort } from '../../../dom/index.mjs'
import { createChatGPTPromptTransport } from '../prompt-index.mjs'
import { createChatGPTDraftSubmission } from '../submission/draft.mjs'

export function createDesktopPromptDispatch(d) {
  async function stepChatGPTReasoningEffortToward(key, entry, wanted) {
    return stepChatGPTEffort({
      key, entry, wanted, behavior: d.CHATGPT_BEHAVIOR,
      executeDOM: d.executeChatGPTDOMScript, requireOwned: d.requireOwnedChatGPTEntry,
      press: d.pressChatGPTControl, pressKey: d.pressChatGPTControlKey,
      wait: d.wait, settleMs: d.CHATGPT_ACCOUNT_ACTION_SETTLE_MS,
      reopenAttempts: d.CHATGPT_MENU_REOPEN_ATTEMPTS,
    })
  }
  const { submitChatGPTDraft, verifyChatGPTDraft } = createChatGPTDraftSubmission({
    ...d, stepChatGPTReasoningEffortToward,
  })
  const prompt = createChatGPTPromptTransport({
    ...d, submitChatGPTDraft, verifyChatGPTDraft,
  })
  return { stepChatGPTReasoningEffortToward, submitChatGPTDraft, ...prompt }
}
