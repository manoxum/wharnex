import { createContext, useCallback, useMemo, useState } from 'react'

export type InternalWindowPersistenceScope = {
  owner: string
  register: (owner: string) => () => void
}

export const InternalWindowPersistenceContext = createContext<InternalWindowPersistenceScope | null>(null)

export function usePersistentInternalWindowOwners<T extends string>(scope: string, candidates: readonly T[], activeOwner: T | '') {
  const [liveWindows, setLiveWindows] = useState<Record<string, number>>({})
  const ownerFor = useCallback((candidate: T) => `${scope}\n${candidate}`, [scope])

  const register = useCallback((owner: string) => {
    setLiveWindows((current) => ({ ...current, [owner]: (current[owner] || 0) + 1 }))
    let registered = true
    return () => {
      if (!registered) return
      registered = false
      setLiveWindows((current) => {
        const remaining = (current[owner] || 0) - 1
        if (remaining > 0) return { ...current, [owner]: remaining }
        if (!(owner in current)) return current
        const next = { ...current }
        delete next[owner]
        return next
      })
    }
  }, [])

  const mountedOwners = useMemo(
    () => candidates.filter((candidate) => candidate === activeOwner || (liveWindows[ownerFor(candidate)] || 0) > 0),
    [activeOwner, candidates, liveWindows, ownerFor],
  )

  return { mountedOwners, ownerFor, register }
}
