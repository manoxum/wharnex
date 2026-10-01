export function registerSpellcheckIPC({ ipcMain, trustedSender }) {
  ipcMain.handle('wharness:spellcheck:show-suggestions', async (event, request) => {
    const windowState = trustedSender(event)
    const [width, height] = windowState.window.getContentSize()
    const rawX = Number(request?.x)
    const rawY = Number(request?.y)
    if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) throw new Error('Invalid spellcheck context-menu point')
    const x = Math.max(0, Math.min(Math.round(rawX), Math.max(0, width - 1)))
    const y = Math.max(0, Math.min(Math.round(rawY), Math.max(0, height - 1)))
    // Chromium provides misspelling metadata only for a trusted browser-level
    // context click. CDP delivers the native pointer interaction at that word.
    windowState.window.focus()
    const input = windowState.window.webContents
    const debuggerAttachedHere = !input.debugger.isAttached()
    if (debuggerAttachedHere) input.debugger.attach('1.3')
    try {
      await input.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await input.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 })
      await input.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 })
    } finally {
      if (debuggerAttachedHere) try { input.debugger.detach() } catch { /* already detached */ }
    }
    return { ok: true }
  })
}
