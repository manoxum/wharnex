import { describe, expect, it, vi } from 'vitest'
import { clearSelfEvolutionBlockForRetry, type SelfEvolutionBlock } from './selfEvolutionRecovery'

const block: SelfEvolutionBlock = {
  phase: 'restarting',
  transaction: 'txn-stuck',
  plan_id: 'plan-old',
  detail: 'activation did not finish',
  remedy: 'inspect the retained rollback baseline',
  releasable: true,
}

describe('clearSelfEvolutionBlockForRetry', () => {
  it('continues immediately when the busy condition was only transient', async () => {
    const release = vi.fn()
    const confirm = vi.fn()
    await expect(clearSelfEvolutionBlockForRetry({
      read: async () => ({ blocked: false }), release, confirm,
    })).resolves.toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled()
  })

  it('keeps a fail-closed transaction when the operator does not acknowledge it', async () => {
    const release = vi.fn()
    await expect(clearSelfEvolutionBlockForRetry({
      read: async () => ({ blocked: true, block }), release, confirm: async () => false,
    })).resolves.toBe(false)
    expect(release).not.toHaveBeenCalled()
  })

  it('releases only the exact acknowledged transaction before retry', async () => {
    const release = vi.fn().mockResolvedValue(undefined)
    const confirm = vi.fn().mockResolvedValue(true)
    await expect(clearSelfEvolutionBlockForRetry({
      read: async () => ({ blocked: true, block }), release, confirm,
    })).resolves.toBe(true)
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('txn-stuck'), confirmLabel: 'Libertar e repetir',
    }))
    expect(release).toHaveBeenCalledWith('txn-stuck')
  })
})
