import { normalizeChatGPTProjectName } from '../naming.mjs'
import { chatGPTOpenConversationMenuScript, chatGPTMenuItemRectScript, chatGPTProjectItemRectScript, chatGPTNewProjectDialogScript } from '../scripts/index.mjs'

export function createAccountProject(context) {
  const {
    runChatGPTAccountAction,
    commitChatGPTAccountControl,
    wait,
    CHATGPT_ACCOUNT_ACTION_SETTLE_MS,
    runChatGPTAccountScript,
  } = context

  // Idempotent by construction: the account's own project inventory decides
  // whether the name already exists before anything is created, and an
  // already-present project is matched case-insensitively so "Wharnex" never
  // creates a sibling of "wharnex". Creation is confirmed by re-reading the same
  // inventory, and a confirmation that finds more than one match is reported as a
  // duplicate rather than silently accepted.
  async function ensureChatGPTProject(key, entry, projectName, conversationId = '') {
    const name = normalizeChatGPTProjectName(projectName)
    return runChatGPTAccountAction('ensure-project', { key, projectName: name }, async () => {
      const opened = await commitChatGPTAccountControl(key, entry, 'move-project-menu', chatGPTOpenConversationMenuScript(conversationId))
      if (!opened.ok) return opened
      const submenu = await commitChatGPTAccountControl(key, entry, 'move-project', chatGPTMenuItemRectScript('move-project'))
      if (!submenu.ok) return submenu
      await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS)

      const existing = await runChatGPTAccountScript(key, entry, 'find-project', chatGPTProjectItemRectScript(name))
      if (existing.ok) return { ok: true, state: 'exists', project: name, duplicates: existing.duplicates || 1, href: existing.href || '' }

      const create = await commitChatGPTAccountControl(key, entry, 'new-project', chatGPTMenuItemRectScript('new-project'))
      if (!create.ok) return { ...create, ok: false, state: 'create-project-unavailable', project: name }
      await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS * 3)
      const staged = await commitChatGPTAccountControl(key, entry, 'commit-project', chatGPTNewProjectDialogScript(name), { attempts: 6 })
      if (!staged.ok) return { ...staged, ok: false, project: name }
      await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS * 4)

      const reopened = await commitChatGPTAccountControl(key, entry, 'confirm-menu', chatGPTOpenConversationMenuScript(conversationId))
      if (!reopened.ok) return { ...reopened, ok: false, state: 'project-not-confirmed', project: name }
      const reSubmenu = await commitChatGPTAccountControl(key, entry, 'confirm-move-project', chatGPTMenuItemRectScript('move-project'))
      if (!reSubmenu.ok) return { ...reSubmenu, ok: false, state: 'project-not-confirmed', project: name }
      await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS)
      const confirmed = await runChatGPTAccountScript(key, entry, 'confirm-project', chatGPTProjectItemRectScript(name))
      if (!confirmed.ok) return { ...confirmed, ok: false, state: 'project-not-confirmed', project: name }
      if ((confirmed.duplicates || 1) > 1) console.warn(`[chatgpt-account] duplicate remote project detected name=${name} count=${confirmed.duplicates}`)
      return { ok: true, state: 'created', project: name, duplicates: confirmed.duplicates || 1, href: confirmed.href || '' }
    })
  }

  return { ensureChatGPTProject }
}
