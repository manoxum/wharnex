export function createAccountInput(context) {
  const {
    dispatchChatGPTPointerPress,
    wait,
    withPreservedLocalFocus,
    CHATGPT_CONTROL_PRESS_HOLD_MS,
    dispatchChatGPTAccountKey,
  } = context

  // Locates a control with a typed script and commits it with a trusted native
  // click. ChatGPT's Radix menu items ignore synthetic HTMLElement.click(), so
  // "locate, then click for real" is the only reliable shape for these controls.
  // Presses a located control on an owned ChatGPT surface.
  //
  // `webContents.sendInputEvent` routes a mouse event through the view's own
  // widget, and a view that is not visible has nothing for it to hit: the event
  // is dropped. Keyboard events do not need hit-testing and still arrive, which
  // is why composer typing and submission always worked on a hidden Worker
  // while every menu this pool tries to open did not - `menu-not-open` on 116
  // DELETE_TEMP_CHAT, 35 RENAME_CHAT and 27 ARCHIVE_CHAT tasks, plus the
  // composer's own reasoning-effort picker.
  //
  // Live CDP testing separated the two: a press dispatched to the very same
  // hidden Worker over the WebContents debugger opened the menu, while the
  // identical press through sendInputEvent did not. The debugger path delivers
  // to the render widget host directly, so it does not depend on the view being
  // composited. The event it produces is a real browser-level input event -
  // `isTrusted`, indistinguishable to the page from the native one - so this
  // stays within ADR-0037's "commit the located target with a trusted native
  // input event"; only the delivery route changes, and only for a surface where
  // the other route silently drops it.
  async function pressChatGPTControl(entry, wc, rect) {
    if (entry?.view?.getVisible?.() !== false) {
      return dispatchChatGPTPointerPress(wc, rect, { wait, guard: withPreservedLocalFocus })
    }
    const x = Math.max(0, Math.floor(Number(rect?.x) || 0))
    const y = Math.max(0, Math.floor(Number(rect?.y) || 0))
    const attachedHere = !wc.debugger.isAttached()
    if (attachedHere) wc.debugger.attach('1.3')
    try {
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
      await wait(CHATGPT_CONTROL_PRESS_HOLD_MS)
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
    } finally {
      if (attachedHere) try { wc.debugger.detach() } catch { /* already detached */ }
    }
    return { x, y }
  }

  // Keyboard counterpart of pressChatGPTControl, for the same reason and with
  // the same closed vocabulary. Keyboard events do not need hit-testing, so they
  // are far likelier to survive sendInputEvent on a hidden view than a mouse
  // press is - but the effort slider is only reachable after that hidden view's
  // menu has been opened over the debugger, and splitting one interaction across
  // two delivery routes is exactly the kind of difference that is invisible
  // until it fails. One surface, one route.
  const CHATGPT_CONTROL_KEYS = Object.freeze({
    Left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
    Right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
    Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
    Space: { key: ' ', code: 'Space', keyCode: 32 },
    Down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  })

  async function pressChatGPTControlKey(entry, wc, name) {
    const mapped = CHATGPT_CONTROL_KEYS[name]
    if (!mapped) throw new Error(`Unsupported ChatGPT control key ${name}`)
    if (entry?.view?.getVisible?.() !== false) {
      withPreservedLocalFocus(() => dispatchChatGPTAccountKey(wc, name))
      return
    }
    const attachedHere = !wc.debugger.isAttached()
    if (attachedHere) wc.debugger.attach('1.3')
    try {
      for (const type of ['keyDown', 'keyUp']) {
        await wc.debugger.sendCommand('Input.dispatchKeyEvent', {
          type, key: mapped.key, code: mapped.code,
          windowsVirtualKeyCode: mapped.keyCode, nativeVirtualKeyCode: mapped.keyCode,
        })
      }
    } finally {
      if (attachedHere) try { wc.debugger.detach() } catch { /* already detached */ }
    }
  }

  return { pressChatGPTControl, pressChatGPTControlKey }
}
