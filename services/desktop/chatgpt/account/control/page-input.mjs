// The hidden Worker has a real layout viewport but Chromium does not always
// treat it as the active page. This scoped CDP setting affects only page input
// routing; it never focuses WebContents or moves the operating-system pointer.
export async function withOwnedChatGPTPageInput(entry, wc, action) {
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

