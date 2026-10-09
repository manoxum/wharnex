import { expect, it, vi } from 'vitest'
import { BundleRoutingError } from '../../../lib/artifacts'
import { deferBundleRouting, createBundleInboxDelivery } from './index'

const bundle = { requestId: 'req-owned', filename: 'owned.zip', cacheKey: '', contentBase64: 'validated-bytes' }
function ports(submit: () => Promise<unknown>) {
  return { submit, acknowledge: vi.fn().mockResolvedValue(undefined), retain: vi.fn().mockResolvedValue(undefined), accepted: vi.fn(), failed: vi.fn() }
}

it('retains a recovered response when another project has no owning chat', async () => {
  const error = new BundleRoutingError('The request belongs to another project')
  const clear = vi.fn()
  const p = ports(async () => deferBundleRouting(error, clear))
  await createBundleInboxDelivery(p)(bundle)
  expect(clear).toHaveBeenCalledOnce()
  expect(p.acknowledge).not.toHaveBeenCalled()
  expect(p.accepted).not.toHaveBeenCalled()
  expect(p.retain).toHaveBeenCalledWith(bundle)
  expect(p.failed).toHaveBeenCalledWith(bundle, error)
})

it('acknowledges only after the owner accepts and permits retry after a routing miss', async () => {
  const submit = vi.fn().mockRejectedValueOnce(new BundleRoutingError('owner not restored')).mockResolvedValueOnce('backend accepted')
  const p = ports(submit)
  const deliver = createBundleInboxDelivery(p)
  await deliver(bundle)
  await deliver(bundle)
  expect(p.retain).toHaveBeenCalledTimes(1)
  expect(p.acknowledge).toHaveBeenCalledTimes(1)
  expect(p.accepted).toHaveBeenCalledTimes(1)
  expect(submit.mock.invocationCallOrder[1]).toBeLessThan(p.acknowledge.mock.invocationCallOrder[0])
})

it('coalesces concurrent deliveries while the owner import is pending', async () => {
  let finish!: () => void
  const p = ports(vi.fn(() => new Promise<void>((resolve) => { finish = resolve })))
  const deliver = createBundleInboxDelivery(p)
  const first = deliver(bundle)
  await deliver(bundle)
  finish()
  await first
  expect(p.submit).toHaveBeenCalledTimes(1)
  expect(p.acknowledge).toHaveBeenCalledTimes(1)
})
