export function nativePauseReason(error = {}, fallback = 'failure') {
  const code = error?.codexErrorInfo
  if (['usageLimitExceeded', 'rateLimitExceeded'].includes(code)) return 'quota'
  if (['contextWindowExceeded', 'sessionBudgetExceeded'].includes(code)) return 'context'
  // Only classify older runtime errors lacking structured codes. This never
  // grants execution: eligibility comes from the owned native lifecycle state.
  if (!code && /^you(?:'|’)ve hit your usage limit\b/i.test(String(error?.message || '').trim())) return 'quota'
  return fallback
}

export function normalizeNativeRecovery(record) {
  if (!record.native || record.status !== 'attention') return false
  const reason = record.pauseReason || nativePauseReason({ message: record.error })
  const changed = record.resumeAvailable !== true || record.pauseReason !== reason
  record.resumeAvailable = true; record.pauseReason = reason
  return changed
}
