import { isNonTerminalBundleRoutingError } from '../../../lib/artifacts'

// Routing failures do not terminate another request. The caller owns delivery
// acknowledgement, so this result must also preserve the pending response.
export function deferBundleRouting(error: unknown, clearError: () => void): string {
  if (!isNonTerminalBundleRoutingError(error)) throw error
  clearError()
  throw error
}
