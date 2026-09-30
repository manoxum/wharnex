import { describe, expect, it, vi } from 'vitest'
import { createTerminalInputQueue } from './terminalInputQueue'

describe('terminal input queue', () => {
  it('sends a burst of typing as one ordered request', async () => {
    const sent: string[] = []
    const queue = createTerminalInputQueue(async (chunk) => { sent.push(chunk) }, vi.fn())
    queue.setReady(true)
    queue.push('a')
    queue.push('b')
    queue.push('c')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sent).toEqual(['abc'])
    queue.dispose()
  })
})
