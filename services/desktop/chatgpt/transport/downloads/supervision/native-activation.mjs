import { withOwnedChatGPTPageInput } from '../../../account/control/index.mjs'
import { chatGPTExactRoleLinkTargetScript } from '../../../downloads/affordances/index.mjs'
import { checkExpectedNativeGuard } from './native-guard.mjs'
import { normalizeNativeDownloadOutcome } from './native-outcome.mjs'

function validatedPoint(target) {
  if (target?.kind !== 'exact-role-link') return null
  const { width, height } = target.viewport || {}
  const { x, y } = target.rect || {}
  if (![width, height, x, y].every(Number.isFinite) || width <= 0 || height <= 0 || width > 32_000 || height > 32_000 || x < 0 || y < 0 || x >= width || y >= height) return null
  return { x: Math.floor(x), y: Math.floor(y) }
}

export function createExpectedDownloadNativeActivation(context) {
  return async (key, entry, expected, selection) => {
    let stage = 'selection'
    let target = selection?.nativeTarget
    const report = (reason, accepted = false) => {
      if (expected) expected.nativeDownloadOutcome = normalizeNativeDownloadOutcome({ accepted, reason, stage, target })
      return accepted
    }
    if (target?.kind !== 'exact-role-link') return report('selection-kind')
    if (selection.mode !== 'exact') return report('selection-not-ready')
    const requestId = expected?.requestId
    const filename = expected?.filename
    const initialWC = entry?.view?.webContents
    let url
    try { url = initialWC?.getURL() } catch { return report('url-unavailable') }
    const boundURL = entry?.affinity?.boundURL
    const snapshot = { key, entry, expected, requestId, filename, initialWC, url, boundURL }
    const guard = () => checkExpectedNativeGuard(context, snapshot)
    try {
      stage = 'initial'
      const initial = guard()
      if (!initial.wc) return report(initial.reason)
      const wc = initial.wc
      if (typeof context.pressChatGPTControl !== 'function') return report('input-unavailable')
      return await withOwnedChatGPTPageInput(entry, wc, async () => {
        stage = 'focus'
        const focused = guard()
        if (!focused.wc) return report(focused.reason)
        // Re-locate by this main-owned expectation after every async boundary;
        // a previously returned point cannot authorize a stale request or slot.
        stage = 'locate'
        target = await wc.executeJavaScript(chatGPTExactRoleLinkTargetScript(filename), true)
        const point = validatedPoint(target)
        if (!point) return report(target?.kind !== 'exact-role-link' ? 'target-kind' : !target?.viewport || !Number.isFinite(target.viewport.width) || !Number.isFinite(target.viewport.height) || target.viewport.width <= 0 || target.viewport.height <= 0 || target.viewport.width > 32_000 || target.viewport.height > 32_000 ? 'target-viewport' : 'target-point')
        stage = 'before-input'
        const ready = guard()
        if (!ready.wc) return report(ready.reason)
        stage = 'input'
        const pressed = await context.pressChatGPTControl(entry, wc, point)
        if (pressed?.x !== point.x || pressed?.y !== point.y) return report('input-unconfirmed')
        stage = 'complete'
        return report('accepted', true)
      })
    } catch { return report('exception') }
  }
}
