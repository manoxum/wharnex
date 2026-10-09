import { behaviorProbeScript, isBehaviorProbeEnabled, normalizeBehaviorProbeResult, chatGPTResponseCompletionScript } from '../../../chatgpt/dom/index.mjs'

export function createTransportShapeProbe({ enabled = isBehaviorProbeEnabled, now = Date.now, log = console.log } = {}) {
  const sampled = new Map()
  return async (key, entry, requestId = '') => {
    if (!enabled() || Number(entry.transportPreparationCount || 0) > 0) return
    const previous = sampled.get(key)
    if (previous && now() - previous.at < 30_000) return
    sampled.set(key, { ...previous, at: now() })
    try {
      const result = {}
      for (const control of ['composer-transport', 'reasoning-effort']) {
        const raw = await entry.view.webContents.executeJavaScript(behaviorProbeScript(control), true)
        result[control] = normalizeBehaviorProbeResult(control, raw)
      }
      if (requestId) {
        const state = await entry.view.webContents.executeJavaScript(chatGPTResponseCompletionScript(), true)
        result.response = { assistantCount: Math.max(0, Number(state?.assistantCount) || 0), thinking: state?.thinking === true,
          failed: state?.failed === true, composerReady: state?.composerReady === true, complete: state?.complete === true }
      }
      const fingerprint = JSON.stringify(result)
      if (previous?.fingerprint !== fingerprint) log(`[chatgpt-behavior-probe] key=${key} request=${requestId || '-'} control=composer-transport shape=${fingerprint}`)
      sampled.set(key, { at: now(), fingerprint })
    } catch { /* diagnostic observation never affects liveness */ }
  }
}
