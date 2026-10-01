// Native input and WebContentsView visibility changes can nominate a remote
// child view as the focused surface after the initiating JavaScript stack has
// returned. Keep the recovery deliberately short: it covers the compositor
// hand-off without taking focus back from a different native window.
export const BACKGROUND_NATIVE_FOCUS_RESTORE_DELAYS_MS = [0, 16, 48]

function isLive(value) {
  return Boolean(value) && typeof value.isDestroyed === 'function' && !value.isDestroyed()
}

/**
 * Runs a synchronous background-native operation while retaining focus in the
 * local Wharnex renderer that already owned it. The caller supplies Electron
 * primitives so this policy stays unit-testable without loading Electron.
 */
export function preserveLocalFocusDuringBackgroundOperation(operation, {
  captureLocal,
  ownerFor,
  isOwnerFocused,
  schedule = (callback, delay) => setTimeout(callback, delay),
} = {}) {
  const contents = captureLocal?.()
  try {
    return operation()
  } finally {
    if (!isLive(contents)) return
    const owner = ownerFor?.(contents)
    if (!isLive(owner)) return
    const restore = () => {
      if (!isLive(contents) || !isLive(owner) || !isOwnerFocused?.(owner)) return
      contents.focus()
    }
    // Cover both an immediate transfer and delayed compositor frames. The
    // owner check makes every delayed restoration a no-op if the user moved to
    // another native window in the meantime.
    restore()
    for (const delay of BACKGROUND_NATIVE_FOCUS_RESTORE_DELAYS_MS) schedule(restore, delay)
  }
}
