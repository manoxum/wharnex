export function createAccountViewport(context) {
  const {
    BrowserWindow,
    desktopWindows,
    preserveLocalFocusDuringBackgroundOperation,
    windowStateForEntry,
    chatgptViews,
  } = context

  // Electron delivers a resize to the renderer only while the view is visible. A
  // setBounds on an already-hidden WebContentsView updates the native bounds and
  // never reaches the page, so innerWidth/innerHeight stay 0. That is measured
  // Electron 44 behaviour, not inference: a hidden slot given bounds reports a 0x0
  // viewport, while the identical slot given the same bounds before being hidden
  // reports 1280x900 and keeps it across later navigations.
  //
  // A 0x0 viewport breaks account automation two ways. Every located control has
  // a centre outside the viewport, so `rect()` returns null and the operation
  // reports `action-offscreen`; and every percentage-width node collapses to
  // width 0, so the shared `visible()` predicate rejects it outright.
  //
  // Granting the viewport is therefore a visible -> resize -> hidden sequence, and
  // it MUST stay synchronous: no compositor frame is produced between the two
  // setVisible calls, so the view never actually appears on screen.
  const CHATGPT_LAYOUT_VIEWPORT = { x: 0, y: 0, width: 1280, height: 900 }

  function focusedLocalWharnexContents() {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    if (!focusedWindow || focusedWindow.isDestroyed()) return undefined
    const state = [...desktopWindows.values()].find((candidate) => candidate.window === focusedWindow)
    const contents = state?.window?.webContents
    return contents && !contents.isDestroyed() && contents.isFocused() ? contents : undefined
  }

  function withPreservedLocalFocus(operation) {
    return preserveLocalFocusDuringBackgroundOperation(operation, {
      captureLocal: focusedLocalWharnexContents,
      ownerFor: (contents) => BrowserWindow.fromWebContents(contents),
      isOwnerFocused: (owner) => BrowserWindow.getFocusedWindow() === owner,
    })
  }

  function grantChatGPTLayoutViewport(view) {
    if (!view || view.webContents?.isDestroyed?.()) return false
    withPreservedLocalFocus(() => {
      view.setVisible(true)
      view.setBounds({ ...CHATGPT_LAYOUT_VIEWPORT })
      view.setVisible(false)
    })
    return true
  }

  // A hidden owned view is never given bounds by the window layout, which leaves
  // its renderer with a zero-sized viewport. Account automation runs on background
  // views (maintenance jobs), so give such a view a real layout viewport without
  // ever making it visible.
  function ensureChatGPTLayoutViewport(key, entry) {
    // Never resize a view the window is actually showing: its bounds belong to
    // the renderer layout, and overwriting them makes the visible ChatGPT surface
    // jump while the user is looking at it.
    //
    // "Showing" is a property of the view, not of the chat. A Worker is hidden
    // even while it owns the very chat the Supervisor has selected — which is the
    // common case, since a chat is organized right after it was used. Matching on
    // the key alone therefore denied a hidden Worker its layout viewport. Only the
    // entry the Supervisor map actually holds for this key is the visible surface;
    // a Worker entry never is.
    const ownerState = windowStateForEntry(entry)
    if (entry?.interactionWindowId && ownerState?.activeAgentInteractionId === entry.slotId) return false
    if (ownerState?.activeChatGPTKey === key && chatgptViews.get(key) === entry) return false
    // The native bounds are NOT evidence the renderer has a viewport, and reading
    // them as if they were is what made this permanent: the first ineffective
    // setBounds left getBounds() reporting 1280x900 while the page stayed at 0x0,
    // so this guard then skipped every later repair. Ownership of the grant is
    // tracked explicitly instead.
    if (entry.layoutViewportGranted === true) return false
    // The viewport has to sit inside the window: Electron clips a child view to
    // its parent, so off-screen bounds collapse the renderer to 0x0. The size is
    // therefore real and at the origin, and the view is marked parked so it can
    // never be shown while carrying these bounds.
    grantChatGPTLayoutViewport(entry.view)
    entry.layoutViewportGranted = true
    entry.parkedLayout = true
    return true
  }

  return { focusedLocalWharnexContents, withPreservedLocalFocus, grantChatGPTLayoutViewport, ensureChatGPTLayoutViewport }
}
