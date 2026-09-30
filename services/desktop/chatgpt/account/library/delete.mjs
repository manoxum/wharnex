import { chatGPTLibraryArtifactRectScript, chatGPTMenuItemRectScript, chatGPTConfirmDeleteScript, chatGPTLibraryArtifactStateScript } from '../chatgpt-account.mjs'

export function createAccountLibraryDelete(context) {
  const {
    sanitizeChatCacheKey,
    path,
    parseBundleName,
    chatgptViews,
    requireOwnedChatGPTEntry,
    serializeChatGPTAccountOperation,
    paceChatGPTWorkerNavigation,
    CHATGPT_LIBRARY_URL,
    loadOwnedChatGPTURL,
    ensureChatGPTLayoutViewport,
    wait,
    CHATGPT_ACCOUNT_ACTION_SETTLE_MS,
    runChatGPTAccountScript,
    withPreservedLocalFocus,
    dispatchChatGPTPointerClick,
    commitChatGPTAccountControl,
  } = context

  async function deleteChatGPTLibraryArtifact(cacheKey, canonicalFilename, artifactID = '', entryOverride = undefined) {
    const key = sanitizeChatCacheKey(cacheKey)
    const filename = path.basename(String(canonicalFilename || '').trim())
    if (!filename || filename !== canonicalFilename || !parseBundleName(filename)) return { ok: false, state: 'invalid-canonical-filename' }
    const entry = entryOverride || chatgptViews.get(key)
    if (!entry) return { ok: false, state: 'view-not-live' }
    requireOwnedChatGPTEntry(key, entry)
    return serializeChatGPTAccountOperation(async () => {
      entry.accountOperationActive = true
      try {
        // See the matching comment in organizeChatGPTConversation - this is the
        // flow a large DELETE_BUNDLE backlog live-reproduced the crash through.
        await paceChatGPTWorkerNavigation()
        if (entry.view.webContents.getURL() !== CHATGPT_LIBRARY_URL) await loadOwnedChatGPTURL(key, entry, CHATGPT_LIBRARY_URL, 'delete-library-artifact')
        ensureChatGPTLayoutViewport(key, entry)
        let located = { ok: false, state: 'artifact-missing', rows: 0 }
        for (let attempt = 0; attempt < 6; attempt += 1) {
          await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS * (attempt ? 2 : 1))
          located = await runChatGPTAccountScript(key, entry, 'library-artifact', chatGPTLibraryArtifactRectScript(filename, artifactID))
          if (located.ok) break
          if (located.state === 'artifact-ambiguous') return located
        }
        if (!located.ok) return located.state === 'artifact-missing' ? { ok: true, state: 'already-deleted' } : located
        withPreservedLocalFocus(() => dispatchChatGPTPointerClick(entry.view.webContents, located.rect))
        const chosen = await commitChatGPTAccountControl(key, entry, 'library-delete', chatGPTMenuItemRectScript('delete'), { attempts: 6 })
        if (!chosen.ok) return chosen
        const confirmed = await commitChatGPTAccountControl(key, entry, 'library-confirm-delete', chatGPTConfirmDeleteScript(), { attempts: 6 })
        if (!confirmed.ok) return confirmed
        for (let attempt = 0; attempt < 6; attempt += 1) {
          await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS * 2)
          const state = await runChatGPTAccountScript(key, entry, 'library-confirm-absent', chatGPTLibraryArtifactStateScript(filename, artifactID || located.artifactId || ''))
          if (state.ok && state.state === 'artifact-absent') return { ok: true, state: 'deleted', artifactId: located.artifactId || artifactID, canonicalFilename: filename }
          if (state.matches > 1) return { ok: false, state: 'artifact-ambiguous' }
        }
        return { ok: false, state: 'delete-not-confirmed' }
      } finally {
        entry.accountOperationActive = false
      }
    })
  }

  return { deleteChatGPTLibraryArtifact }
}
