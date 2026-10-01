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
  let sized = { width: 0, height: 0 }

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

  const requestedSize = () => ({
    width: Math.max(1, Math.floor(Number(bounds?.width) || PARKED_SIZE.width)),
    height: Math.max(1, Math.floor(Number(bounds?.height) || PARKED_SIZE.height)),
  })

  function detachFrom(window) {
    try { if (window && !window.isDestroyed()) window.contentView.removeChildView(box) } catch { /* window is closing */ }
  }

  host.attach(box)
  native.webContents.once('destroyed', () => { detachFrom(presentedIn); host.detach(box) })

  return {
    native,
    webContents: native.webContents,
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
    present(window, target) {
      if (presentedIn === window) return this.resizePresented(target)
      if (presentedIn) this.release()
      host.detach(box)
      native.setBounds({ x: 0, y: 0, width: target.width, height: target.height })
      native.setVisible(true)
      window.contentView.addChildView(box)
      box.setBounds(target)
      presentedIn = window
    },
    resizePresented(target) {
      if (!presentedIn) return
      const current = box.getBounds()
      if (current.width !== target.width || current.height !== target.height) {
        presentedIn.contentView.removeChildView(box)
        native.setBounds({ x: 0, y: 0, width: target.width, height: target.height })
        presentedIn.contentView.addChildView(box)
      }
      box.setBounds(target)
    },
    release() {
      if (!presentedIn) return
      native.setVisible(false)
      detachFrom(presentedIn)
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
