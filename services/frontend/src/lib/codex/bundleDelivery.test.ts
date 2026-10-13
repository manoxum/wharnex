import { describe, expect, it, vi } from 'vitest'
import { validatePlannerBundle } from './bundleDelivery'

describe('Codex validated bundle handoff', () => {
  it('acknowledges backend acceptance before preparing a derived turn', async () => {
    const steps: string[] = []
    const result = await validatePlannerBundle(async () => { steps.push('validate'); return { workflow_prepared: true } }, async () => { steps.push('acknowledge') })
    if (result.workflow_prepared) steps.push('next-turn')
    expect(steps).toEqual(['validate', 'acknowledge', 'next-turn'])
  })
  it('retains a rejected bundle and does not release its request', async () => {
    const acknowledge = vi.fn()
    await expect(validatePlannerBundle(async () => { throw new Error('Invalid protocol') }, acknowledge)).rejects.toThrow('Invalid protocol')
    expect(acknowledge).not.toHaveBeenCalled()
  })
})
