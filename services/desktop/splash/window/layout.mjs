export const SPLASH_WIDTH = 700
export const COLLAPSED_HEIGHT = 375
export const EXPANDED_HEIGHT = 570

export function resizeSplashWindow(window, collapsed) {
  if (typeof collapsed !== 'boolean' || window.isDestroyed()) return
  const height = collapsed ? COLLAPSED_HEIGHT : EXPANDED_HEIGHT
  if (window.getSize()[1] === height) return
  // Linux locks the native size when resizable=false, including programmatic size changes.
  window.setResizable(true)
  try { window.setSize(SPLASH_WIDTH, height) }
  finally { window.setResizable(false) }
}
