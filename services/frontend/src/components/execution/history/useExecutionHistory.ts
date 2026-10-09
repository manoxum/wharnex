import { useEffect, useMemo, useRef, useState } from 'react'
import type { HarnessEvent, Session } from '../../../types'
import { api } from '../../../lib/transport/http/api'

export function useExecutionHistory(session: Session, selectedTab: string) {
  const [history, setHistory] = useState<{ sessionId: string; events: HarnessEvent[] }>({ sessionId: '', events: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const loadedKey = useRef('')
  // Each continuation can clear the snapshot and push its prior execution out
  // of the bounded live window, even though all rounds share one root request.
  const requestKey = useMemo(() => `${session.id}:${Object.keys(session.request_lineages || {}).sort().join('|')}`, [session.id, session.request_lineages])
  useEffect(() => {
    if (selectedTab !== 'plan' && selectedTab !== 'terminal') return
    if (loadedKey.current === requestKey) return
    let cancelled = false
    setLoading(true); setError('')
    void api.eventHistory(session.id, true).then((result) => {
      if (cancelled) return
      setHistory({ sessionId: session.id, events: result.events || [] })
      loadedKey.current = requestKey
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o histórico durável.')
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [requestKey, selectedTab, session.id])
  return { events: history.sessionId === session.id ? history.events : [], loading, error: history.sessionId && history.sessionId !== session.id ? '' : error }
}
