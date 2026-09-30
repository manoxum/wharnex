import { describe, expect, it } from 'vitest'
import { lastRule } from '../../cascade/styleRules'

describe('execution queue CSS', () => {
  it('keeps the FIFO drawer compact and neutral instead of using accent-tinted cards', () => {
    const drawer = lastRule('.execution-queue-drawer')
    const metrics = lastRule('.execution-queue-metric')
    const concurrency = lastRule('.execution-queue-concurrency')
    const card = lastRule('.execution-queue-card')

    expect(drawer).toContain('background: var(--theme-bg)')
    expect(metrics).toContain('display: inline-flex')
    expect(metrics).not.toContain('box-shadow')
    expect(concurrency).toContain('border-top: 1px solid var(--theme-border-soft)')
    expect(card).toContain('background: var(--theme-surface)')
    expect(card).toContain('box-shadow: none')
  })
})
