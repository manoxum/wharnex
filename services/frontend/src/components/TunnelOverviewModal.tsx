import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { AppConfig, TunnelTestResult } from '../types'
import { Icon } from './Icon'

export function TunnelOverviewModal({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<AppConfig>()
  const [testing, setTesting] = useState('')
  const [results, setResults] = useState<Record<string, TunnelTestResult | string>>({})
  const [error, setError] = useState('')
  useEffect(() => { api.config().then(setConfig).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))) }, [])
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close) }, [onClose])
  const tunnels = useMemo(() => [...(config?.remote_input?.instances || [])].sort((a, b) => a.priority - b.priority), [config])
  async function test(instanceID: string) {
    setTesting(instanceID)
    try { const result = await api.testTunnel(instanceID); setResults((current) => ({ ...current, [instanceID]: result })) }
    catch (cause) { setResults((current) => ({ ...current, [instanceID]: cause instanceof Error ? cause.message : String(cause) })) }
    finally { setTesting('') }
  }
  return <div className="modal-backdrop tunnel-overview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="tunnel-overview" role="dialog" aria-modal="true" aria-labelledby="tunnel-overview-title">
      <header><div><span className="panel-kicker">Infraestrutura remota</span><h2 id="tunnel-overview-title">Túneis ativos</h2><p>Rotas públicas ordenadas pela prioridade efetiva do WHX.</p></div><button className="icon-button light" onClick={onClose} aria-label="Fechar túneis"><Icon name="close" size={14}/></button></header>
      {error && <div className="tunnel-empty danger-text">{error}</div>}
      <div className="tunnel-overview-list">{tunnels.map((tunnel, index) => {
        const result = results[tunnel.id]
        return <article key={tunnel.id}>
          <span className="tunnel-priority">{String(index + 1).padStart(2, '0')}</span>
          <div><strong>{tunnel.provider}</strong><code>{tunnel.public_url || 'URL pública ainda não publicada'}</code><small>{tunnel.available ? 'Ativo' : tunnel.error || 'Indisponível'} · prioridade {tunnel.priority}</small>{result && <em className={typeof result === 'string' ? 'failed' : ''}>{typeof result === 'string' ? result : `Ligação confirmada em ${result.latency_ms} ms`}</em>}</div>
          <button className="secondary-button" disabled={!tunnel.public_url || testing === tunnel.id} onClick={() => void test(tunnel.id)}>{testing === tunnel.id ? 'A testar…' : 'Testar'}</button>
        </article>
      })}{config && !tunnels.length && <div className="tunnel-empty">Nenhum túnel ativo. Configure um provedor nas definições do projeto.</div>}</div>
    </section>
  </div>
}
