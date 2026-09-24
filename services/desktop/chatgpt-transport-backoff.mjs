// Network-class transport faults (net::ERR_NETWORK_CHANGED, a dropped
// connection, a failed DNS lookup) are first the page's own business: ChatGPT
// retries its conversation stream by itself. Reloading at once turned every
// network flap into a full page load per view, and several views reloading
// together into a burst that ChatGPT answered with HTTP 429. A network fault
// therefore waits — longer on each reload already spent — and is dropped when
// the conversation shows progress again. Renderer faults (crash, hang) are not
// network faults and keep their immediate reload.

export const NETWORK_FAULT_RELOAD_DELAYS_MS = [20_000, 60_000, 180_000]
export const NETWORK_FAULT_GLOBAL_SPACING_MS = 15_000

export function isNetworkRecoveryFault(fault) {
  return /\bERR_[A-Z0-9_]+\b/.test(String(fault || ''))
}

export function networkFaultReloadDelayMs(state) {
  const spent = Math.max(0, Number(state?.transportReloadCount) || 0)
  return NETWORK_FAULT_RELOAD_DELAYS_MS[Math.min(spent, NETWORK_FAULT_RELOAD_DELAYS_MS.length - 1)]
}

// 'none' — not a network fault; 'recovered' — progress since the fault, so the
// page healed itself; 'deferred' — still inside the grace delay; 'due' — reload.
export function networkFaultStatus(state, now) {
  if (!state?.pendingFault || !isNetworkRecoveryFault(state.pendingFault)) return 'none'
  const faultAt = Number(state.pendingFaultAt) || 0
  if (Number(state.lastProgressAt || 0) > faultAt) return 'recovered'
  return now - faultAt < networkFaultReloadDelayMs(state) ? 'deferred' : 'due'
}

// A network flap hits every view at once; spacing their reloads across the
// whole Desktop keeps recovery from becoming a request burst.
export function createNetworkReloadGate(spacingMs = NETWORK_FAULT_GLOBAL_SPACING_MS) {
  let lastAt = -Infinity
  return (now) => {
    if (now - lastAt < spacingMs) return false
    lastAt = now
    return true
  }
}

export const claimNetworkFaultReloadSlot = createNetworkReloadGate()
