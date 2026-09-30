export type ResumeExpectedBundleResult = {
  ok: boolean
  reason?: 'write_in_progress' | 'write_not_submitted' | 'resend_required'
}

export type PendingDeliveryResumeOutcome = 'supervised' | 'wait' | 'resend'

// Classifies what Desktop found when asked to resume supervision of a pending
// request after a restart. A request whose prompt+ZIP never reached the bound
// conversation (no structural proof, or a terminal write that never finished)
// must surface as a failed delivery with its resend action; ignoring that
// answer left the chat pending forever with nothing to click.
export function pendingDeliveryResumeOutcome(result?: ResumeExpectedBundleResult): PendingDeliveryResumeOutcome {
  if (result?.ok) return 'supervised'
  if (result?.reason === 'resend_required' || result?.reason === 'write_not_submitted') return 'resend'
  return 'wait'
}
