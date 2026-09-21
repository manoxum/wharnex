export const INTERNAL_WINDOW_DOCK_ID = 'wharnex-internal-window-dock'

export function ensureInternalWindowDockRoot() {
  if (typeof document === 'undefined') return null
  let root = document.getElementById(INTERNAL_WINDOW_DOCK_ID)
  if (root) return root
  root = document.createElement('div')
  root.id = INTERNAL_WINDOW_DOCK_ID
  root.className = 'internal-window-dock'
  root.setAttribute('aria-label', 'Janelas minimizadas')
  document.body.appendChild(root)
  return root
}
