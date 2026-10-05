export function createChatGPTFileUpload({
  chatGPTKeyForEntry, requireOwnedChatGPTEntry, pasteWithUploadRetry,
  paceChatGPTWorkerSubmission, chatAgentRateLimitDelayMs,
  ChatGPTRateLimitDeferral, chatAgentWorkerActivity,
  waitForChatGPTSurfaceReady, chatGPTComposerReadyScript,
  chatGPTUploadThumbnailScript, path, chatGPTUploads,
  selectChatGPTUploadFile, chatGPTHumanActionScript, setChatGPTHumanAction, chatGPTHumanActionMessage,
}) {
  // A sign-in, verification or access gate is not a transient DOM miss: every
  // retry would select the file on a page that cannot accept it. Classify it
  // before selection, publish human attention once and stop retrying.
  async function assertNoHumanGate(wc, key) {
    if (!chatGPTHumanActionScript) return
    const health = await wc.executeJavaScript(chatGPTHumanActionScript(), true).catch(() => null)
    if (health?.required !== true) return
    const kind = String(health.kind || 'verification')
    setChatGPTHumanAction?.(key, kind, '', 'upload')
    const message = chatGPTHumanActionMessage?.(kind) || `ChatGPT requires human action before uploading (${kind})`
    throw Object.assign(new Error(message), { humanAction: kind, retryUpload: false })
  }

  async function pasteChatGPTFile(entry, filePath, index, count, { translation = false, pacedWorker = false } = {}) {
    const key = chatGPTKeyForEntry(entry)
    const { wc } = requireOwnedChatGPTEntry(key, entry)
    let uploadBaseline
    const result = await pasteWithUploadRetry({
      beforeAttempt: async () => {
        // A retry is a fresh provider-facing action: without this, two Workers
        // retiring their own 500ms/1s/2s/4s backoffs independently can still
        // land their file-selection attempts on ChatGPT within the same couple
        // of seconds, and live testing showed that contention is exactly what
        // pushes an upload that would otherwise start past the coordinator's
        // observation window. The shared gate spaces retries the same way it
        // already spaces first attempts and navigation.
        if (pacedWorker) await paceChatGPTWorkerSubmission({ translation })
        if (pacedWorker && !translation) {
          const suspension = chatAgentRateLimitDelayMs()
          if (suspension > 0) throw new ChatGPTRateLimitDeferral(suspension)
        }
        chatAgentWorkerActivity.set('uploading')
        await waitForChatGPTSurfaceReady(key, entry)
        await assertNoHumanGate(wc, key)
        const ready = await wc.executeJavaScript(chatGPTComposerReadyScript(), true)
        if (!ready) throw new Error(`ChatGPT composer DOM was not found before upload (${await surfaceShape(wc)})`)
        uploadBaseline = await wc.executeJavaScript(chatGPTUploadThumbnailScript(path.basename(filePath)), true)
      },
      beginUpload: () => chatGPTUploads.expect(wc.id, {
        // The upload card is the provider's live, structural acknowledgement.
        // It is scoped to the active composer and compares the pre-selection
        // structural baseline when this rollout omits filename metadata. It
        // returns only counts/progress/state; no response text or account data is
        // read. Network observation remains the compatibility fallback.
        observe: () => wc.executeJavaScript(chatGPTUploadThumbnailScript(path.basename(filePath)), true),
        baselineMarkerCount: uploadBaseline?.markerCount,
        onProgress: ({ progress, complete }) => console.debug(`[chatgpt-upload] wc=${wc.id} file=${index}/${count} progress=${progress}% complete=${complete}`),
      }),
      cancelUpload: (error) => chatGPTUploads.cancel(wc.id, `ChatGPT upload selection failed: ${error instanceof Error ? error.message : String(error)}`),
      paste: async () => {
        await selectChatGPTUploadFile(wc, filePath)
      },
      onRetry: ({ attempt, error }) => {
        console.warn(`[chatgpt-upload] retry wc=${wc.id} file=${index}/${count} failedAttempt=${attempt} error=${error.message}`)
      },
    })
    console.log(`[chatgpt-upload] confirmed wc=${wc.id} file=${index}/${count} observed=${result.observed}`)
  }

  return { pasteChatGPTFile }
}

// Structural shape of a page whose composer is missing, for diagnosis only:
// the route kind and the presence of known controls, never page text.
const SURFACE_SHAPE_SCRIPT = `(() => ({
  route: /^\\/c\\//.test(location.pathname) ? 'conversation' : (location.pathname === '/' ? 'home' : 'other'),
  signIn: Boolean(document.querySelector('[data-testid="login-button"],[data-testid="signup-button"]')),
  errorBanner: Boolean(document.querySelector('[data-testid*="error" i],[role="alert"]')),
  dialog: Boolean(document.querySelector('[role="dialog"]')),
  loading: document.readyState,
}))()`

async function surfaceShape(wc) {
  try {
    const shape = await wc.executeJavaScript(SURFACE_SHAPE_SCRIPT, true)
    return `route=${shape?.route} signIn=${shape?.signIn} error=${shape?.errorBanner} dialog=${shape?.dialog} state=${shape?.loading}`
  } catch { return 'shape unavailable' }
}
