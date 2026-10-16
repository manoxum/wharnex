import { describe, expect, it, vi } from 'vitest'
import type { HarnessEvent } from '../../../../types/agent/task-queue'
import { eventSearchText } from './eventSearchText'

describe('eventSearchText', () => {
  it('serializes event data once while searches change', () => {
    const toJSON = vi.fn(() => ({ result: 'verification failed' }))
    const event = { data: { toJSON } } as unknown as HarnessEvent
    expect(eventSearchText(event)).toBe('{"result":"verification failed"}')
    expect(eventSearchText(event)).toBe('{"result":"verification failed"}')
    expect(toJSON).toHaveBeenCalledTimes(1)
  })
})
