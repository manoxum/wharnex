import { CHATGPT_REASONING_EFFORTS } from './chatgpt-effort.mjs'
import { reasoningEffortAdjustScript, reasoningEffortStateScript } from '../../agent/automation/chat-agent-scripts.mjs'

import { withOwnedChatGPTPageInput as withWorkerPageInput } from '../account/control/index.mjs'

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
    // The menu is open but its slider is not usable yet (still animating in, or
    // a shape the map does not know). Pressing again would close it, so only
    // observe; if it never becomes usable, close the menu once and report.
    for (let attempt = 0; attempt < reopenAttempts && staged?.state === 'effort-menu-open-no-slider'; attempt += 1) {
      await wait(settleMs)
      staged = await executeDOM(key, entry, 'reasoning-effort-adjust', reasoningEffortAdjustScript(behavior))
    }
    if (!staged?.ok || staged.state !== 'effort-slider-ready') {
      log(`[chatgpt-effort] key=${key} slider-unavailable state=${String(staged?.state || 'unknown')} controlled=${staged?.controlled === true} scopes=${Number(staged?.scopes || 0)} sliders=${JSON.stringify(staged?.sliders || [])}`)
      if (staged?.triggerExpanded === true) await pressKey(entry, wc, 'Escape')
      throw new Error(`ChatGPT reasoning-effort slider is unavailable (${String(staged?.state || 'unknown')})`)
    }
    await pressKey(entry, wc, direction)
    await pressKey(entry, wc, 'Escape')
    await wait(settleMs)
  })
}
