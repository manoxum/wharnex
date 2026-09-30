import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../../lib/transport/http/api'
import { errorMessage } from '../../../lib/workspace/dialogs/errorMessage'
import type { OrchestratorPlanningDetail, OrchestratorPlanningRequest } from '../../../types'

export function useOrchestratorPlanningDetail(sessionId: string, requests: OrchestratorPlanningRequest[]) {
  const [request, setRequest] = useState<OrchestratorPlanningRequest>()
  const [detail, setDetail] = useState<OrchestratorPlanningDetail>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const loadRef = useRef(0)

  const load = useCallback(async (requestId: string) => {
    const loadId = ++loadRef.current
    setLoading(true)
    setError(undefined)
    try {
      const value = await api.orchestratorPlanningDetail(sessionId, requestId)
      if (loadRef.current === loadId) setDetail(value)
    } catch (reason) {
      if (loadRef.current === loadId) setError(errorMessage(reason, 'Não foi possível carregar o detalhe do planeamento.'))
    } finally {
      if (loadRef.current === loadId) setLoading(false)
    }
  }, [sessionId])

  const requestId = request?.request_id
  useEffect(() => {
    if (requestId) void load(requestId)
  }, [load, requestId])

  useEffect(() => {
    setRequest((current) => current
      ? requests.find((item) => item.request_id === current.request_id) || current
      : current)
  }, [requests])

  const open = useCallback((nextRequest: OrchestratorPlanningRequest) => {
    loadRef.current += 1
    setRequest(nextRequest)
    setDetail(undefined)
    setError(undefined)
  }, [])

  const close = useCallback(() => {
    loadRef.current += 1
    setRequest(undefined)
    setDetail(undefined)
    setError(undefined)
    setLoading(false)
  }, [])

  const refresh = useCallback(() => {
    if (requestId) void load(requestId)
  }, [load, requestId])

  return { request, detail, loading, error, open, close, refresh }
}
