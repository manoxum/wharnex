import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { PairingScreen } from './components/PairingScreen'
import { RemoteWorkspace } from './components/RemoteWorkspace'
import { pairingCodeFromScan } from './lib/pairing'

export default function App() {
  const [paired, setPaired] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')

  const claim = useCallback(async (code: string) => {
    setChecking(true); setError('')
    try { await api.claimPairing(code); setPaired(true); const url = new URL(window.location.href); url.searchParams.delete('pair'); window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setChecking(false) }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function boot() {
      try {
        const code = pairingCodeFromScan(window.location.href)
        if (code) { await claim(code); return }
        const status = await api.pairingStatus()
        if (!cancelled) setPaired(status.paired)
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)) }
      finally { if (!cancelled) setChecking(false) }
    }
    void boot(); return () => { cancelled = true }
  }, [claim])

  if (!paired) return <PairingScreen checking={checking} error={error} onCode={claim}/>
  return <RemoteWorkspace onDisconnect={async () => { await api.endPairing(); setPaired(false) }}/>
}
