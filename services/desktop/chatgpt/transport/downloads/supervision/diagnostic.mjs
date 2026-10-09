import { normalizeDownloadDiagnostic } from '../../../downloads/affordances/index.mjs'
import { normalizeNativeDownloadOutcome } from './native-outcome.mjs'

const REASONS = new Set(['observed', 'queued-comment', 'pending-delivery', 'manual', 'expired', 'ownership', 'preparing', 'surface', 'human-gate', 'backoff', 'recovery', 'loading', 'delivered', 'download-in-flight', 'invalid-bundle-held', 'download-retry-delay', 'native-input-rejected', 'native-input-retry-delay'])
export function createDownloadDiagnosticRecorder(log = (...args) => console.log(...args)) {
  return (key, expected, raw, reason = 'observed', at = Date.now()) => {
    if (!expected) return
    try {
      const snapshot = { reason: REASONS.has(reason) ? reason : 'surface', ...normalizeDownloadDiagnostic(raw) }
      if (expected.nativeDownloadOutcome) snapshot.native = normalizeNativeDownloadOutcome(expected.nativeDownloadOutcome)
      const fingerprint = JSON.stringify(snapshot)
      if (expected.downloadDiagnosticFingerprint === fingerprint && at - Number(expected.downloadDiagnosticLoggedAt || 0) < 30_000) return
      expected.downloadDiagnosticFingerprint = fingerprint
      expected.downloadDiagnosticLoggedAt = at
      log(`[chatgpt-bundle-probe] key=${key} request=${expected.requestId} file=${expected.filename} diagnostic=${fingerprint}`)
    } catch { /* Observability must never change the work being observed. */ }
  }
}
