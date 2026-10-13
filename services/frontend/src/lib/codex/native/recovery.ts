import type { CodexThread } from '../contracts'

// Older Desktop snapshots did not carry resumeAvailable. Attention itself
// identifies an interrupted native request; the main process verifies it again.
export function canResumeNative(thread: CodexThread) {
  return Boolean(thread.native && (thread.status === 'attention' || thread.status === 'idle' && thread.resumeAvailable))
}
