type Bundle = { requestId: string; filename: string; cacheKey?: string; contentBase64: string }
type Params = {
  submit: (bundle: Bundle) => Promise<unknown>
  acknowledge: (bundle: Bundle) => Promise<unknown>
  retain: (bundle: Bundle) => Promise<unknown>
  accepted: (bundle: Bundle) => void
  failed: (bundle: Bundle, error: unknown) => void
}

export function createBundleInboxDelivery(params: Params) {
  const inflight = new Set<string>()
  return async (bundle: Bundle) => {
    const key = `${bundle.requestId}:${bundle.filename}`
    if (inflight.has(key)) return
    inflight.add(key)
    try {
      await params.submit(bundle)
      await params.acknowledge(bundle)
      params.accepted(bundle)
    } catch (error) {
      await params.retain(bundle).catch(() => undefined)
      params.failed(bundle, error)
    } finally { inflight.delete(key) }
  }
}
