import { describe, expect, it } from 'vitest'
import { lastRule } from '../../cascade/styleRules'

describe('execution queue visual hierarchy', () => {
  it('keeps FIFO entries flat with a semantic state rail', () => {
    const list = lastRule('.execution-queue-list')
    const card = lastRule('.execution-queue-card')

    expect(list).toContain('gap: 0')
    expect(card).toContain('background: transparent')
    expect(card).toContain('border-radius: 0')
    expect(card).toContain('box-shadow: inset 2px 0 var(--queue-tone)')
  })
})
