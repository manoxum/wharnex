import type { Session } from '../../../types'

// A host Git conflict waits for the operator's choice before anything reaches
// the model; only the backend's `auto_dispatch` mark (GPT-only hand-off to a
// dedicated chat, or an explicit delegation) makes it sendable automatically.
// Integration conflicts keep their existing automatic continuation.
export function conflictAutoDispatchable(session: Session) {
  const git = session.integration_conflict?.git
  return !git || Boolean(git.auto_dispatch)
}

export function gitConflictChatTitle(session: Session) {
  const git = session.integration_conflict?.git
  return `Conflito Git · ${git?.ref || 'merge'}`
}
