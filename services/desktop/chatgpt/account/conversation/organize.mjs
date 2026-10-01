import { chatGPTShowSidebarScript, normalizeChatGPTProjectName, chatGPTProjectItemRectScript, chatGPTCommitConversationTitleScript, chatGPTConversationTitleScript, normalizeWHXTitle } from '../chatgpt-account.mjs'

export function createAccountOrganize(context) {
  const {
    sanitizeChatCacheKey,
    ensureChatGPTView,
    requireOwnedChatGPTEntry,
    serializeChatGPTAccountOperation,
    paceChatGPTWorkerNavigation,
    requireTrustedChatGPTURL,
    sameConversationURL,
    loadOwnedChatGPTURL,
    waitForChatGPTSurfaceReady,
    ensureChatGPTLayoutViewport,
    chatGPTConversationID,
    commitChatGPTAccountControl,
    wait,
    CHATGPT_ACCOUNT_ACTION_SETTLE_MS,
    ensureChatGPTProject,
    chooseChatGPTConversationAction,
    runChatGPTAccountScript,
    withPreservedLocalFocus,
    dispatchChatGPTPointerClick,
    dispatchChatGPTAccountKey,
    hideChatGPTSidebar,
  } = context

  async function organizeChatGPTConversation(cacheKey, projectName, title, expectedURL = '', entryOverride = undefined) {
    const key = sanitizeChatCacheKey(cacheKey)
    const entry = entryOverride || ensureChatGPTView(key).entry
    requireOwnedChatGPTEntry(key, entry)
    return serializeChatGPTAccountOperation(async () => {
      entry.accountOperationActive = true
      try {
        // Account-lifecycle actions are provider-facing navigation exactly like
        // a submission is; live testing found this whole class of action (a
        // DELETE_BUNDLE backlog of over a hundred items above all) sharing only
        // serializeChatGPTAccountOperation's back-to-back queue and none of the
        // process-wide navigation gate, hammering chatgpt.com without a single
        // request ever spaced out - severe enough to crash the desktop.
        await paceChatGPTWorkerNavigation()
        if (expectedURL) {
          const target = requireTrustedChatGPTURL(expectedURL)
          if (!sameConversationURL(entry.view.webContents.getURL(), target)) await loadOwnedChatGPTURL(key, entry, target, 'organize-conversation')
          await waitForChatGPTSurfaceReady(key, entry)
        }
        ensureChatGPTLayoutViewport(key, entry)
        const conversationId = chatGPTConversationID(entry.view.webContents.getURL())
        const shown = await commitChatGPTAccountControl(key, entry, 'show-sidebar', chatGPTShowSidebarScript())
        if (!shown.ok) return shown
        if (shown.state === 'opening') await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS)

        // ensureChatGPTProject leaves the "Move to project" submenu open with the
        // wanted project present, so selecting it is the very next click.
        const project = await ensureChatGPTProject(key, entry, projectName, conversationId)
        if (!project.ok) return { ...project, ok: false, project: project.project || normalizeChatGPTProjectName(projectName) }
        if (Number(project.duplicates || 1) > 1) return { ok: false, state: 'duplicate-project', project: project.project, duplicates: project.duplicates }
        const selected = await commitChatGPTAccountControl(key, entry, 'select-project', chatGPTProjectItemRectScript(project.project))
        if (!selected.ok) return { ...selected, ok: false, project: project.project }
        await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS * 3)

        const rename = await chooseChatGPTConversationAction(key, entry, 'rename', conversationId)
        if (!rename.ok) return { ...rename, ok: false, project: project.project }
        await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS)
        // The rename control is an inline sidebar input, not a dialog: stage the
        // value, then commit it with a trusted Enter the same way the composer is
        // submitted, and confirm from the row's own label.
        const staged = await runChatGPTAccountScript(key, entry, 'commit-title', chatGPTCommitConversationTitleScript(title))
        if (!staged.ok) return { ...staged, ok: false, project: project.project }
        const { wc } = requireOwnedChatGPTEntry(key, entry)
        withPreservedLocalFocus(() => {
          dispatchChatGPTPointerClick(wc, staged.rect)
          dispatchChatGPTAccountKey(wc, 'Enter')
        })
        await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS * 3)
        const committed = await runChatGPTAccountScript(key, entry, 'confirm-title', chatGPTConversationTitleScript(conversationId))
        return { ok: Boolean(committed.ok), state: committed.ok ? 'renamed' : committed.state, project: project.project, title: normalizeWHXTitle(title) }
      } finally {
        entry.accountOperationActive = false
        await hideChatGPTSidebar(key, entry).catch(() => undefined)
      }
    })
  }

  return { organizeChatGPTConversation }
}
