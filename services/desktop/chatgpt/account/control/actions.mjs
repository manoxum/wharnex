import { chatGPTOpenConversationMenuScript, chatGPTMenuItemRectScript } from '../scripts/index.mjs'

export function createAccountActions(context) {
  const {
    wait,
    CHATGPT_ACCOUNT_ACTION_SETTLE_MS,
    runChatGPTAccountScript,
    requireOwnedChatGPTEntry,
    pressChatGPTControl,
    runChatGPTAccountAction,
    CHATGPT_MENU_REOPEN_ATTEMPTS,
  } = context

  async function commitChatGPTAccountControl(key, entry, stage, script, { attempts = 4 } = {}) {
    let located = { ok: false, state: 'action-unavailable' }
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS)
      located = await runChatGPTAccountScript(key, entry, stage, script)
      // Some typed operations are already satisfied (for example the sidebar
      // is already visible/hidden) and deliberately return no click target.
      if (located.ok && !located.rect) return located
      if (located.ok && located.rect) break
    }
    if (!located.ok || !located.rect) return located
    const { wc } = requireOwnedChatGPTEntry(key, entry)
    // A held press, not an instantaneous click. Radix opens a menu on
    // pointerdown and reconciles it against the pointerup that follows, so both
    // landing in the same tick settles the trigger back closed - live CDP
    // testing isolated this on the composer's effort picker, where an
    // instantaneous down/up left `aria-expanded` false every time and the same
    // press with a short hold opened the menu reliably. These conversation
    // menus are the same kind of Radix trigger, and `menu-not-open` is by far
    // this queue's largest failure class: 116 DELETE_TEMP_CHAT, 35 RENAME_CHAT
    // and 27 ARCHIVE_CHAT tasks have died on it.
    await pressChatGPTControl(entry, wc, located.rect)
    return located
  }

  async function chooseChatGPTConversationAction(key, entry, action, conversationId = '') {
    const providerAction = action === 'move-project' ? 'move-conversation' : `${action}-conversation`
    return runChatGPTAccountAction(providerAction, { key }, async () => {
      let located = { ok: false, state: 'menu-not-open' }
      for (let attempt = 0; attempt < CHATGPT_MENU_REOPEN_ATTEMPTS; attempt += 1) {
        const opened = await commitChatGPTAccountControl(key, entry, `${action}-menu`, chatGPTOpenConversationMenuScript(conversationId))
        if (!opened.ok) return opened
        located = await commitChatGPTAccountControl(key, entry, action, chatGPTMenuItemRectScript(action))
        if (located.state !== 'menu-not-open') return located
      }
      return located
    })
  }

  return { commitChatGPTAccountControl, chooseChatGPTConversationAction }
}
