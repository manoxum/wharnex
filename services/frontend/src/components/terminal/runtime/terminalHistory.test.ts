import { describe, expect, it, vi } from 'vitest'
import { createTerminalHistory } from './terminalHistory'
import { MAX_PERSISTED_TERMINAL_HISTORY } from './interactiveTerminalSupport'

describe('terminal history snapshots', () => {
  it('keeps the recent tail after a stream of small output frames', () => {
    const emit = vi.fn()
    const history = createTerminalHistory('', '.', () => 3, emit)
    for (let index = 0; index < 400; index += 1) history.append('x'.repeat(1024))
    history.append('latest')
    history.flush()
    expect(emit).toHaveBeenCalledWith({ cwd: '.', history: expect.stringMatching(/latest$/), viewportY: 3 })
    expect(emit.mock.calls[0][0].history).toHaveLength(MAX_PERSISTED_TERMINAL_HISTORY)
  })
})
