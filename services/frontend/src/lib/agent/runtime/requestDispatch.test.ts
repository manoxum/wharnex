import { describe, expect, it } from 'vitest'
import type { ChatItem } from '../../../types'
import { hasRecordedRequest } from './requestDispatch'

describe('hasRecordedRequest', () => {
  it('recognizes a durable repair dispatch across frontend reloads', () => {
    const items = [{
      id: 'repair-req-1', role: 'harness', source: 'wharness', text: 'Repair', createdAt: new Date().toISOString(),
      iteration: { id: 'req-1', requestId: 'req-1', phase: 'repair', artifacts: ['error'] },
    }] as ChatItem[]
    expect(hasRecordedRequest(items, 'req-1', ['repair'])).toBe(true)
    expect(hasRecordedRequest(items, 'req-2', ['repair'])).toBe(false)
  })

  it('does not mistake the original submitted request for a workflow continuation dispatch', () => {
    const items = [{
      id: 'user-req-1', role: 'user', source: 'user', text: 'Investigate', createdAt: new Date().toISOString(),
      iteration: { id: 'req-1', requestId: 'req-1', phase: 'submitted', artifacts: ['prompt'] },
    }] as ChatItem[]
    expect(hasRecordedRequest(items, 'req-1', ['workflow'])).toBe(false)
  })
})
