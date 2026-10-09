import { withOwnedChatGPTPageInput } from '../../../account/control/index.mjs'
import { chatGPTExactRoleLinkTargetScript } from '../../../downloads/affordances/index.mjs'

function validatedPoint(target) {
  if (target?.kind !== 'exact-role-link') return null
  const { width, height } = target.viewport || {}
  const { x, y } = target.rect || {}
  if (![width, height, x, y].every(Number.isFinite) || width <= 0 || height <= 0 || width > 32_000 || height > 32_000 || x < 0 || y < 0 || x >= width || y >= height) return null
  return { x: Math.floor(x), y: Math.floor(y) }
}

export function createExpectedDownloadNativeActivation(context) {
  return async (key, entry, expected, selection) => {
    if (selection?.nativeTarget?.kind !== 'exact-role-link' || selection.mode !== 'exact') return false
    const requestId = expected?.requestId
    const filename = expected?.filename
    const initialWC = entry?.view?.webContents
    let url
    try { url = initialWC?.getURL() } catch { return false }
    const boundURL = entry?.affinity?.boundURL
    const guard = () => {
      if (!requestId || !filename || context.expectedChatGPTBundles.get(key) !== expected || expected.requestId !== requestId || expected.filename !== filename
        || context.chatgptViews.get(key) !== entry || entry.loading || entry.externalAuthProvider || entry.authWindowOpen || entry.embeddedAuthActive
        || Number(entry.transportPreparationCount || 0) > 0 || context.chatgptTransportModes.get(key) === 'manual'
        || (entry.humanAction?.active && !['transport', 'stalled'].includes(entry.humanAction.kind))
        || context.hasPendingChatGPTComments(key) || context.pendingChatGPTBundleDeliveries.has(requestId) || context.recentlyDeliveredChatGPTBundleRequestId(requestId)
        || Date.now() - expected.armedAt > context.EXPECTED_BUNDLE_TTL_MS || entry.affinity?.boundURL !== boundURL
        || !context.chatGPTSupervisorOwnsExpectedResponse(key, requestId, url)) return null
      const { wc } = context.requireOwnedChatGPTEntry(key, entry)
      return wc === initialWC && !wc.isDestroyed() && wc.getURL() === url && context.isTrustedChatGPTOrigin(url) ? wc : null
    }
    try {
      const wc = guard()
      if (!wc || typeof context.pressChatGPTControl !== 'function') return false
      return await withOwnedChatGPTPageInput(entry, wc, async () => {
        if (!guard()) return false
        // Re-locate by this main-owned expectation after every async boundary;
        // a previously returned point cannot authorize a stale request or slot.
        const target = await wc.executeJavaScript(chatGPTExactRoleLinkTargetScript(filename), true)
        const point = validatedPoint(target)
        if (!point || !guard()) return false
        const pressed = await context.pressChatGPTControl(entry, wc, point)
        return pressed?.x === point.x && pressed?.y === point.y
      })
    } catch { return false }
  }
}
