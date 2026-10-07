import { observeBundleDownload } from '../../transport/usage/index.mjs'

export function createChatGPTDownloadRouter({
  chatGPTWorkerEntries, chatAgentWorkerActivity,
  registerOrchestratorExecutionDownload, expectedChatGPTOrchestratorExecutions,
  tempPath, registerChatGPTOrchestratorPlanDownload,
  registerChatGPTMarkdownTranslationDownload,
  registerReleaseNotesBundleDownload, expectedChatGPTReleaseNotes,
  registerChatGPTTodoClassificationDownload, registerChatGPTUITestDiscoveryDownload = () => false, expectedChatGPTBundleForDownload,
  chatGPTKeyForWebContents, canonicalWharnexBundleDownload,
  BundleOwnershipError, path, publishBundleDownloadError,
  handleBundleDownload, handleLegacyPlanDownload,
}) {
  function registerChatGPTPlanDownloads(chatSession) {
    chatSession.on('will-download', (_event, item, sourceWebContents) => {
      // Generated attachments may use an internal download WebContents. Strict
      // filename and request ownership checks, rather than object identity,
      // decide whether an automated download is accepted.
      const sourceFilename = item.getFilename()
      const accepted = (handled) => {
        if (handled) observeBundleDownload(item, sourceFilename)
        return handled
      }
      const downloadingWorker = chatGPTWorkerEntries.find((candidate) => {
        const wc = candidate?.view?.webContents
        return wc && !wc.isDestroyed() && (sourceWebContents === wc || sourceWebContents?.hostWebContents === wc)
      })
      if (downloadingWorker) chatAgentWorkerActivity.setFor(downloadingWorker.slotId, 'downloading')
      if (accepted(registerOrchestratorExecutionDownload(item, sourceFilename, expectedChatGPTOrchestratorExecutions, tempPath()))) return
      if (accepted(registerChatGPTOrchestratorPlanDownload(item, sourceFilename))) return
      if (accepted(registerChatGPTMarkdownTranslationDownload(item, sourceFilename))) return
      if (accepted(registerReleaseNotesBundleDownload(item, sourceFilename, expectedChatGPTReleaseNotes, tempPath()))) return
      if (accepted(registerChatGPTTodoClassificationDownload(item, sourceFilename))) return
      if (accepted(registerChatGPTUITestDiscoveryDownload(item, sourceFilename))) return
      const expectedBundle = expectedChatGPTBundleForDownload(sourceWebContents, sourceFilename)
      const sourceCacheKey = expectedBundle?.key || chatGPTKeyForWebContents(sourceWebContents)
      let bundleCandidate
      try {
        bundleCandidate = canonicalWharnexBundleDownload(sourceFilename, expectedBundle?.requestId || '', item.getMimeType?.() || '', sourceCacheKey || '', expectedBundle?.filename || '')
      } catch (error) {
        if (error instanceof BundleOwnershipError && error.requestId && error.filename) {
          // Another chat's valid response is routed by request ID through the
          // durable inbox rather than cancelled against the visible chat.
          bundleCandidate = { requestId: error.requestId, filename: error.filename, normalized: path.basename(sourceFilename) !== error.filename, unrouted: true }
          console.warn(`[chatgpt-bundle-download] cross-request bundle accepted for routing file=${error.filename} request=${error.requestId}`)
        } else {
          item.cancel()
          publishBundleDownloadError(error instanceof Error ? error.message : String(error), sourceFilename, sourceCacheKey)
          return
        }
      }
      if (bundleCandidate) {
        observeBundleDownload(item, bundleCandidate.filename)
        handleBundleDownload(item, sourceFilename, sourceWebContents, expectedBundle, sourceCacheKey, bundleCandidate)
        return
      }
      if (sourceFilename.startsWith('whx_bundle_res_')) {
        item.cancel()
        publishBundleDownloadError('Nome do bundle inválido; esperado whx_bundle_res_<chat_id>_<request_id>.zip.', sourceFilename, sourceCacheKey)
        return
      }
      handleLegacyPlanDownload(item, sourceFilename, sourceWebContents, sourceCacheKey)
    })
  }
  return { registerChatGPTPlanDownloads }
}
