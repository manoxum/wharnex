export const isRemoteApp = import.meta.env.VITE_REMOTE_APP === 'true'

export function remoteWorkspaceMode<T extends 'editor' | 'agent' | 'orchestrator'>(mode: T): T | 'agent' {
  return isRemoteApp && mode === 'editor' ? 'agent' : mode
}
