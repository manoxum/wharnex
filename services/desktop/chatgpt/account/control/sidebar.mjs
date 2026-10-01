import { chatGPTHideSidebarScript } from '../chatgpt-account.mjs'

export function createAccountSidebar(context) {
  const {
    isTrustedChatGPTOrigin,
    runChatGPTAccountAction,
    commitChatGPTAccountControl,
  } = context

  async function hideChatGPTSidebar(key, entry) {
    if (!entry || entry.view.webContents.isDestroyed() || !isTrustedChatGPTOrigin(entry.view.webContents.getURL())) return { ok: false, state: 'unavailable' }
    return runChatGPTAccountAction('hide-sidebar', { key }, () => commitChatGPTAccountControl(key, entry, 'hide-sidebar', chatGPTHideSidebarScript()))
  }

  return { hideChatGPTSidebar }
}
