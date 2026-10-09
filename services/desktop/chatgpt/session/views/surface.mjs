const PARKED_SIZE = Object.freeze({ width: 1280, height: 900 })

// Every Supervisor and Worker WebContentsView lives inside its own container
// View, parked at the origin of the browser host window (see
// window/lifecycle/browser-monitor.mjs). Electron 44 on Linux never repaints a
// WebContentsView that was sized while attached at a non-zero window offset
// once it is re-parented, so the content view is sized only at the host origin
// or while its container is out of any window; only the container is moved and
// positioned. That is what lets the browser monitor present the real view and
// hand it back intact.
//
// The rest of the Desktop still drives `entry.view` as if it were the project's
// Engine surface. This surface records that request - bounds and visibility in
// the project pane, which shows a mirror - and gives the real view the same
// size, so the page lays out for the pane that mirrors it. Whether the real view
// is composited is decided only by the browser monitor, which is what
// `getVisible()` reports, because automation input routing depends on it.
export function createHostedChatGPTSurface(native, { View, host }) {
  const box = new View()
  box.addChildView(native)
  let bounds
  let visible = false
  let presentedIn
  let keepsContentSize = false
  let sized = { width: 0, height: 0 }
  let automationHolds = 0

  // Electron delivers a resize to the renderer only while the view is visible;
  // the synchronous show/resize/hide produces no compositor frame on screen,
  // and it also recreates the surface a parked navigation may have dropped.
  function sizeNative(width, height, force = false) {
    if (presentedIn || native.webContents.isDestroyed()) return
    if (!force && sized.width === width && sized.height === height) return
    native.setVisible(true)
    native.setBounds({ x: 0, y: 0, width, height })
    box.setBounds({ x: 0, y: 0, width, height })
    native.setVisible(false)
    sized = { width, height }
  }

  const requestedSize = () => automationHolds > 0 ? PARKED_SIZE : ({
    width: Math.max(1, Math.floor(Number(bounds?.width) || PARKED_SIZE.width)),
    height: Math.max(1, Math.floor(Number(bounds?.height) || PARKED_SIZE.height)),
  })

  // A view just attached to the monitor shows nothing until its renderer
  // produces a new frame, and a page that is not repainting never does on its
  // own. A visible one-pixel capture forces that frame; invalidate() does not
  // (measured on Electron 44). It runs again shortly after, once the native
  // attachment has settled.
  function refreshFrame() {
    const wc = native.webContents
    const force = () => {
      if (presentedIn && !wc.isDestroyed()) void wc.capturePage({ x: 0, y: 0, width: 1, height: 1 }).catch(() => undefined)
    }
    force()
    setTimeout(force, 200)
  }

  function detachFrom(window) {
    try { if (window && !window.isDestroyed()) window.contentView.removeChildView(box) } catch { /* window is closing */ }
  }

  function sizePresented(width, height) {
    presentedIn.contentView.removeChildView(box)
    native.setBounds({ x: 0, y: 0, width, height })
    presentedIn.contentView.addChildView(box)
    sized = { width, height }
  }

  host.attach(box)
  native.webContents.once('destroyed', () => { detachFrom(presentedIn); host.detach(box) })
  // Earlier builds compensated a presented Worker with zoom, which Chromium
  // applies to the whole origin and persists; agent views always render at 1.
  native.webContents.on('did-finish-load', () => {
    if (!native.webContents.isDestroyed() && native.webContents.getZoomFactor() !== 1) native.webContents.setZoomFactor(1)
  })

  return {
    native,
    webContents: native.webContents,
    holdAutomationViewport() {
      automationHolds += 1
      if (presentedIn) sizePresented(PARKED_SIZE.width, PARKED_SIZE.height)
      else sizeNative(PARKED_SIZE.width, PARKED_SIZE.height)
      let released = false
      return () => {
        if (released) return
        released = true
        automationHolds -= 1
        const size = requestedSize()
        if (!automationHolds && presentedIn && !keepsContentSize) {
          const target = box.getBounds()
          sizePresented(target.width, target.height)
        } else sizeNative(size.width, size.height)
      }
    },
    setBounds(next) {
      bounds = { x: Number(next?.x) || 0, y: Number(next?.y) || 0, width: Number(next?.width) || 0, height: Number(next?.height) || 0 }
      const size = requestedSize()
      sizeNative(size.width, size.height)
    },
    getBounds() { return bounds ? { ...bounds } : { x: 0, y: 0, ...PARKED_SIZE } },
    // Whether the owning project pane shows this surface (as a mirror).
    setVisible(next) { visible = Boolean(next) },
    isVisible() { return visible },
    // Whether the real view is composited on screen right now.
    getVisible() { return Boolean(presentedIn) && native.getVisible() },
    setBackgroundColor(color) { native.setBackgroundColor(color) },
    isPresented() { return Boolean(presentedIn) },
    // A Worker presented mid-task keeps its content size so its automation
    // layout never changes; the container then crops or pads it.
    present(window, target, { keepContentSize = false } = {}) {
      if (presentedIn === window) return this.resizePresented(target)
      if (presentedIn) this.release()
      host.detach(box)
      keepsContentSize = keepContentSize
      if (!keepsContentSize && !automationHolds) native.setBounds({ x: 0, y: 0, width: target.width, height: target.height })
      native.setVisible(true)
      window.contentView.addChildView(box)
      box.setBounds(target)
      presentedIn = window
      refreshFrame()
    },
    resizePresented(target) {
      if (!presentedIn) return
      const current = box.getBounds()
      if (!keepsContentSize && !automationHolds && (current.width !== target.width || current.height !== target.height)) sizePresented(target.width, target.height)
      box.setBounds(target)
      refreshFrame()
    },
    release() {
      if (!presentedIn) return
      detachFrom(presentedIn)
      native.setVisible(false)
      presentedIn = undefined
      host.attach(box)
      const size = requestedSize()
      sizeNative(size.width, size.height, true)
    },
    // A parked view whose surface is gone cannot be captured; recreate it.
    paint() {
      const size = requestedSize()
      sizeNative(size.width, size.height, true)
    },
  }
}
