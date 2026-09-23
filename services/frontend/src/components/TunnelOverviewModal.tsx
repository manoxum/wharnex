import { useCallback, useEffect, useMemo, useState } from 'react'
import { remoteApi, type PairingStart, type TunnelControlAction } from '../lib/remoteApi'
import type { AppConfig, TunnelTestResult } from '../types'
import { Icon } from './Icon'
import { InternalWindow } from './InternalWindow'

const iconButton = 'grid size-8 shrink-0 place-items-center rounded-lg border border-whx-border bg-whx-muted text-whx-soft transition hover:bg-whx-hover hover:text-whx-text disabled:cursor-not-allowed disabled:opacity-40'

export function TunnelOverviewModal({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<AppConfig>()
  const [busy, setBusy] = useState('')
  const [results, setResults] = useState<Record<string, TunnelTestResult | string>>({})
  const [pairing, setPairing] = useState<PairingStart>()
  const [error, setError] = useState('')
  const refresh = useCallback(() => remoteApi.config().then(setConfig).catch((cause) => setError(message(cause))), [])
  useEffect(() => { void refresh() }, [refresh])
  const tunnels = useMemo(() => [...(config?.remote_input?.instances || [])].sort((a, b) => a.priority - b.priority), [config])

  async function run(instanceID: string, action: 'test' | TunnelControlAction | 'pair') {
    setBusy(`${instanceID}:${action}`)
    setError('')
    try {
      if (action === 'test') {
        const result = await remoteApi.testTunnel(instanceID)
        setResults((current) => ({ ...current, [instanceID]: result }))
      } else if (action === 'pair') setPairing(await remoteApi.startPairing(instanceID))
      else { await remoteApi.controlTunnel(instanceID, action); await refresh() }
    } catch (cause) {
      if (action === 'test') setResults((current) => ({ ...current, [instanceID]: message(cause) }))
      else setError(message(cause))
    } finally { setBusy('') }
  }

  return <InternalWindow title="Túneis ativos" layerClassName="fixed inset-0 z-[10030] grid place-items-center bg-[var(--theme-overlay)] p-4 backdrop-blur-[5px] sm:p-6" onClose={onClose}>
    <section className="grid max-h-[min(680px,calc(100dvh-32px))] w-[min(760px,calc(100vw-24px))] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl border border-whx-border bg-whx-surface text-whx-text shadow-[0_24px_72px_var(--theme-shadow)]" role="dialog" aria-modal="false" aria-labelledby="tunnel-overview-title">
      <header className="flex min-h-[76px] items-start justify-between gap-4 border-b border-whx-border bg-whx-elevated px-4 py-3.5">
        <div><span className="font-mono text-xs font-bold uppercase tracking-[0.12em] text-whx-accent">Infraestrutura remota</span><h2 id="tunnel-overview-title" className="mb-1 mt-1 text-xl font-semibold">Túneis ativos</h2><p className="m-0 max-w-[52ch] text-sm leading-5 text-whx-faint">Controle cada rota pública e gere uma sessão de emparelhamento para o Wharnex Remote.</p></div>
        <button className={iconButton} onClick={onClose} aria-label="Fechar túneis"><Icon name="close" size={14}/></button>
      </header>
      <div className="min-h-0 overflow-auto p-2.5">
        {error && <Empty icon="alert" title="A operação não foi concluída" detail={error} danger />}
        {tunnels.map((tunnel, index) => {
          const result = results[tunnel.id]
          const state = tunnel.state || (tunnel.available ? 'active' : 'unavailable')
          const active = state === 'active'
          return <article key={tunnel.id} className="mb-2 grid grid-cols-[34px_minmax(0,1fr)] gap-2.5 rounded-xl border border-whx-border-soft bg-whx-elevated p-3 sm:grid-cols-[34px_minmax(0,1fr)_auto] sm:items-center">
            <span className="font-mono text-base font-bold text-whx-accent">{String(index + 1).padStart(2, '0')}</span>
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="text-base">{tunnel.provider}</strong><StateBadge state={state}/></div><code className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap font-mono text-sm text-whx-soft">{tunnel.public_url || 'URL pública ainda não publicada'}</code><small className="mt-1 block text-xs text-whx-faint">prioridade {tunnel.priority}{tunnel.error ? ` · ${tunnel.error}` : ''}</small>{result && <em className={`mt-1 block text-xs not-italic ${typeof result === 'string' ? 'text-whx-danger' : 'text-whx-success'}`}>{typeof result === 'string' ? result : `Ligação confirmada em ${result.latency_ms} ms`}</em>}</div>
            <div className="col-span-2 flex flex-wrap justify-end gap-1.5 sm:col-span-1">
              {active ? <><Action title="Pausar temporariamente" icon="pause" disabled={busy !== ''} onClick={() => void run(tunnel.id, 'pause')}/><Action title="Parar até retomar" icon="stop" disabled={busy !== ''} onClick={() => void run(tunnel.id, 'stop')}/></> : <Action title="Retomar túnel" icon="play" disabled={busy !== '' || state === 'unavailable'} onClick={() => void run(tunnel.id, 'resume')}/>}
              <Action title="Copiar link público" icon="copy" disabled={!tunnel.public_url} onClick={() => void copyText(tunnel.public_url || '')}/>
              <Action title="Abrir no navegador" icon="external" disabled={!tunnel.public_url} onClick={() => window.open(tunnel.public_url, '_blank', 'noopener,noreferrer')}/>
              <Action title="Emparelhar Wharnex Remote" icon="link" disabled={!tunnel.public_url || !active || busy !== ''} onClick={() => void run(tunnel.id, 'pair')}/>
              <Action title="Testar ligação" icon="network" disabled={!tunnel.public_url || busy !== ''} onClick={() => void run(tunnel.id, 'test')}/>
            </div>
          </article>
        })}
        {config && !tunnels.length && <Empty icon="network" title="Nenhum túnel ativo" detail="Configure um provedor nas definições do projeto para publicar uma rota remota." />}
      </div>
    </section>
    {pairing && <PairingDialog pairing={pairing} onClose={() => setPairing(undefined)} />}
  </InternalWindow>
}

function Action({ title, icon, disabled, onClick }: { title: string; icon: 'pause' | 'stop' | 'play' | 'copy' | 'external' | 'link' | 'network'; disabled?: boolean; onClick: () => void }) {
  return <button type="button" className={iconButton} disabled={disabled} onClick={onClick} aria-label={title} title={title}><Icon name={icon} size={14}/></button>
}

function StateBadge({ state }: { state: string }) {
  const label = state === 'active' ? 'Ativo' : state === 'paused' ? 'Pausado' : state === 'stopped' ? 'Parado' : 'Indisponível'
  const tone = state === 'active' ? 'text-whx-success' : state === 'paused' ? 'text-whx-warning' : state === 'stopped' ? 'text-whx-faint' : 'text-whx-danger'
  return <span className={`rounded-full border border-whx-border-soft bg-whx-muted px-2 py-0.5 font-mono text-xs font-semibold ${tone}`}>{label}</span>
}

function PairingDialog({ pairing, onClose }: { pairing: PairingStart; onClose: () => void }) {
  return <div className="fixed inset-0 z-[10040] grid place-items-center bg-[var(--theme-overlay)] p-4 backdrop-blur-[7px]" role="dialog" aria-modal="true" aria-labelledby="pairing-title">
    <section className="w-full max-w-[31rem] rounded-2xl border border-whx-border bg-whx-surface p-5 text-whx-text shadow-[0_30px_90px_var(--theme-shadow)] sm:p-7"><div className="flex items-start justify-between gap-4"><div><span className="font-mono text-xs font-bold uppercase tracking-[0.12em] text-whx-accent">Emparelhamento temporário</span><h3 id="pairing-title" className="mb-1 mt-1 text-xl">Ligue o navegador remoto</h3><p className="m-0 text-sm leading-5 text-whx-faint">O código é de uso único e expira automaticamente.</p></div><button className={iconButton} onClick={onClose} aria-label="Fechar emparelhamento"><Icon name="close" size={14}/></button></div><div className="my-5 grid place-items-center rounded-xl border border-whx-border-soft bg-whx-elevated p-4"><img src={pairing.qr_code} className="size-[min(68vw,300px)] rounded-lg p-2" alt="QR para emparelhar o Wharnex Remote" /></div><code className="block overflow-hidden text-ellipsis whitespace-nowrap rounded-lg bg-whx-muted px-3 py-2 font-mono text-xs text-whx-soft">{pairing.pairing_url}</code><div className="mt-4 flex items-center justify-between gap-3"><small className="text-xs text-whx-faint">Expira em {new Date(pairing.expires_at).toLocaleTimeString()}</small><button className="rounded-lg border border-whx-border bg-whx-muted px-3 py-2 text-sm font-semibold text-whx-text hover:bg-whx-hover" onClick={() => void copyText(pairing.pairing_url)}>Copiar link</button></div></section>
  </div>
}

function Empty({ icon, title, detail, danger = false }: { icon: 'network' | 'alert'; title: string; detail: string; danger?: boolean }) {
  return <div className="grid min-h-[138px] place-items-center content-center gap-1.5 px-5 py-6 text-center"><span className={`mb-1 grid size-9 place-items-center rounded-lg border border-whx-border-soft bg-whx-elevated ${danger ? 'text-whx-danger' : 'text-whx-faint'}`}><Icon name={icon} size={18}/></span><strong className="text-base text-whx-soft">{title}</strong><span className="max-w-[340px] text-sm leading-5 text-whx-faint">{detail}</span></div>
}

async function copyText(value: string) { if (value) await navigator.clipboard.writeText(value) }
function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause) }
