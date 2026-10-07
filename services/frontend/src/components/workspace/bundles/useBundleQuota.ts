import { useCallback, useEffect, useRef, useState } from 'react'
import type { BundleQuota } from '../../../types'
import { api } from '../../../lib/transport/http/api'

export function useBundleQuota(refreshKey: string) {
  const [quota, setQuota] = useState<BundleQuota>()
  const [error, setError] = useState('')
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    const request = ++generation.current
    try {
      const value = await api.bundleQuota()
      if (request !== generation.current) return
      setQuota(value)
      setError('')
    } catch {
      if (request === generation.current) setError('Não foi possível atualizar as estatísticas de bundles.')
    }
  }, [])
  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 60_000)
    return () => { generation.current += 1; window.clearInterval(timer) }
  }, [refresh, refreshKey])
  return { quota, error, refresh }
}
