import { APIError } from './api'

type APIErrorEnvelope = { error?: { code?: unknown } }

export class BundleRoutingError extends Error {}

// A late or duplicate download belongs to transport routing, not to the
// validity of the request that is currently active in the chat. It must never
// close that newer request as a protocol failure.
export function isNonTerminalBundleRoutingError(error: unknown) {
  if (error instanceof BundleRoutingError) return true
  if (!(error instanceof APIError)) return false
  const code = (error.data as APIErrorEnvelope | undefined)?.error?.code
  return code === 'execution_bundle_request_mismatch' || code === 'execution_bundle_not_pending'
}
