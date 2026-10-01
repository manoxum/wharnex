import { describe, expect, it } from 'vitest'
import { pendingDeliveryResumeOutcome } from './pendingDeliveryResume'

describe('pendingDeliveryResumeOutcome', () => {
  it('keeps supervision only when Desktop proved and armed the original submission', () => {
    expect(pendingDeliveryResumeOutcome({ ok: true })).toBe('supervised')
  })

  it('turns a never-submitted request into a resendable delivery failure', () => {
    expect(pendingDeliveryResumeOutcome({ ok: false, reason: 'resend_required' })).toBe('resend')
    expect(pendingDeliveryResumeOutcome({ ok: false, reason: 'write_not_submitted' })).toBe('resend')
  })

  it('waits while a durable write is still running or the answer is missing', () => {
    expect(pendingDeliveryResumeOutcome({ ok: false, reason: 'write_in_progress' })).toBe('wait')
    expect(pendingDeliveryResumeOutcome(undefined)).toBe('wait')
  })
})
