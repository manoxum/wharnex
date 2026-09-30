import { afterEach, describe, expect, it } from 'vitest'
import { chatGPTOverlayBlocked, observeChatGPTOverlayBlockers } from './chatGPTOverlay'

afterEach(() => { document.body.innerHTML = '' })

describe('chatGPTOverlayBlocked', () => {
  it('blocks only explicit trusted overlays', () => {
    document.body.innerHTML = '<div role="menu" class="untrusted-menu"></div><div class="error-toast"></div>'
    expect(chatGPTOverlayBlocked(window)).toBe(false)
    document.body.innerHTML = '<div data-chatgpt-overlay-blocker="true"></div>'
    expect(chatGPTOverlayBlocked(window)).toBe(true)
  })

  it('ignores explicit blockers that are not visually active', () => {
    document.body.innerHTML = `
      <div class="internal-window-layer is-minimized" data-chatgpt-overlay-blocker="true"></div>
      <div data-chatgpt-overlay-blocker="true" hidden></div>
      <div aria-hidden="true"><div data-chatgpt-overlay-blocker="true"></div></div>
      <div style="display:none"><div data-chatgpt-overlay-blocker="true"></div></div>
      <details data-chatgpt-overlay-blocker="true"><summary>Recentes</summary></details>
    `
    expect(chatGPTOverlayBlocked(window)).toBe(false)
    document.querySelector('details')?.setAttribute('open', '')
    expect(chatGPTOverlayBlocked(window)).toBe(true)
  })

  it('recomputes when a trusted overlay becomes active or hidden', async () => {
    const states: boolean[] = []
    const stop = observeChatGPTOverlayBlockers(window, (blocked) => states.push(blocked))
    const blocker = document.createElement('div')
    blocker.dataset.chatgptOverlayBlocker = 'true'
    document.body.append(blocker)
    await Promise.resolve()
    blocker.hidden = true
    await Promise.resolve()
    stop()
    expect(states[0]).toBe(false)
    expect(states).toContain(true)
    expect(states.at(-1)).toBe(false)
  })
})
