import { useEffect } from 'react'
import { subscribeGitLiveSync } from './gitLiveSync'

// The overview already lists every repository. One project-level invalidation
// reloads that inventory as well, including newly added submodules.
export function useGitLiveRefresh(sessionId: string, refresh: () => void | Promise<unknown>) {
  useEffect(() => {
    if (!sessionId) return
    return subscribeGitLiveSync(sessionId, () => { void Promise.resolve(refresh()).catch(() => {}) })
  }, [sessionId, refresh])
}
