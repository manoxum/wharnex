import { CHATGPT_REASONING_EFFORTS } from './chatgpt-effort.mjs'
import { reasoningEffortAdjustScript, reasoningEffortStateScript } from './chat-agent-scripts.mjs'

// The hidden Worker has a real layout viewport but Chromium does not always
// treat it as the active page. This scoped CDP setting affects only page input
// routing; it never focuses WebContents or moves the operating-system pointer.
async function withWorkerPageInput(entry, wc, action) {
  if (entry?.view?.getVisible?.() !== false) return action()
  const attachedHere = !wc.debugger.isAttached()
  if (attachedHere) wc.debugger.attach('1.3')
  let emulated = false
  try {
    await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    emulated = true
    return await action()
  } finally {
    if (emulated) await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => undefined)
    if (attachedHere) try { wc.debugger.detach() } catch { /* already detached */ }
  }
}

export async function stepChatGPTEffort({ key, entry, wanted, behavior, executeDOM, requireOwned, press, pressKey, wait, settleMs, reopenAttempts, log = console.log }) {
  const wantedIndex = CHATGPT_REASONING_EFFORTS.indexOf(wanted)
  if (wantedIndex < 0) throw new Error(`Unsupported ChatGPT reasoning effort ${wanted}`)
  const current = await executeDOM(key, entry, 'reasoning-effort-state', reasoningEffortStateScript(behavior))
  if (!current?.ok) throw new Error(`ChatGPT reasoning effort is unavailable (${String(current?.state || 'unknown')})`)
  if (current.effort === wanted) return
  const direction = CHATGPT_REASONING_EFFORTS.indexOf(current.effort) < wantedIndex ? 'Right' : 'Left'
  const { wc } = requireOwned(key, entry)

  await withWorkerPageInput(entry, wc, async () => {
    let staged = await executeDOM(key, entry, 'reasoning-effort-adjust', reasoningEffortAdjustScript(behavior))
    for (let attempt = 0; attempt < reopenAttempts && staged?.ok && staged.state === 'effort-menu-closed'; attempt += 1) {
      const visible = entry?.view?.getVisible?.()
      const pressed = await press(entry, wc, staged.rect)
      await wait(settleMs)
      const before = staged
      staged = await executeDOM(key, entry, 'reasoning-effort-adjust', reasoningEffortAdjustScript(behavior))
      if (staged?.state === 'effort-menu-closed' && staged.triggerFocused === true) {
        for (const openKey of ['Enter', 'Space', 'Down']) {
          await pressKey(entry, wc, openKey)
          await wait(settleMs)
          staged = await executeDOM(key, entry, 'reasoning-effort-adjust', reasoningEffortAdjustScript(behavior))
          if (staged?.state !== 'effort-menu-closed') break
        }
      }
      log(`[chatgpt-effort] key=${key} open-attempt=${attempt + 1} visible=${String(visible)} pressed=${pressed.x},${pressed.y} rect=${JSON.stringify(before.rect)} viewport=${JSON.stringify(before.viewport || null)} hit=${JSON.stringify(before.hit || null)} hitIsControl=${before.hitIsControl === true} focused=${staged?.triggerFocused === true} expanded=${staged?.triggerExpanded === true} disabled=${staged?.triggerDisabled === true} dataState=${String(staged?.triggerState || '')} pointerEvents=${String(staged?.triggerPointerEvents || '')} sliders=${Number(staged?.sliderCount || 0)} menus=${Number(staged?.openMenuCount || 0)} -> ${String(staged?.state || 'unknown')}`)
    }
    if (!staged?.ok || staged.state !== 'effort-slider-ready') {
      throw new Error(`ChatGPT reasoning-effort slider is unavailable (${String(staged?.state || 'unknown')})`)
    }
    await pressKey(entry, wc, direction)
    await pressKey(entry, wc, 'Escape')
    await wait(settleMs)
  })
}
