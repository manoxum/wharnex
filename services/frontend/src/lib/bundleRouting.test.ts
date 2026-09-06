import { describe, expect, it } from 'vitest'
import { APIError } from './api'
import { isNonTerminalBundleRoutingError } from './bundleRouting'

describe('bundle routing failures', () => {
  it.each(['execution_bundle_request_mismatch', 'execution_bundle_not_pending'])(
    'does not make %s terminal for the active request',
    (code) => {
      const error = new APIError('late bundle', 409, { error: { code } })
      expect(isNonTerminalBundleRoutingError(error)).toBe(true)
    },
  )

  it('keeps malformed current bundles terminal', () => {
    const error = new APIError('invalid plan', 400, { error: { code: 'invalid_execution_bundle' } })
    expect(isNonTerminalBundleRoutingError(error)).toBe(false)
  })
})
