import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import type { AppConfig, TunnelInstance } from './types'

type PairingState = 'checking' | 'waiting' | 'paired' | 'error'
type BusyAction = { instanceID: string; action: string } | null

function messageOf(cause: unknown) { return cause instanceof Error ? cause.message : String(cause) }

export default function App() {
  const [pairing, setPairing] = useState<PairingState>('checking')
  const [config, setConfig] = useState<AppConfig>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<BusyAction>(null)
  const instances = useMemo(() => config?.remote_input?.instances || [], [config])

  const refresh = useCallback(async () => {
    const next = await api.config()
    setConfig(next)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function boot() {
      try {
        const params = new URLSearchParams(window.location.search)
        const code = params.get('pair') || ''
        if (code) {
          await api.claimPairing(code)
          params.delete('pair')
          const query = params.toString()
          window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
        }
        const status = await api.pairingStatus()
        if (cancelled) return
        if (!status.paired) { setPairing('waiting'); return }
        setPairing('paired')
        await refresh()
      } catch (cause) {
        if (!cancelled) { setError(messageOf(cause)); setPairing('error') }
      }
    }
    void boot()
    return () => { cancelled = true }
  }, [refresh])

  async function control(instanceID: string, action: 'pause' | 'stop' | 'resume') {
    setBusy({ instanceID, action }); setError('')
    try {
      const result = await api.controlTunnel(instanceID, action)
      setConfig((current) => current ? { ...current, remote_input: result.remote_input } : { remote_input: result.remote_input })
    } catch (cause) { setError(messageOf(cause)) } finally { setBusy(null) }
  }

  async function test(instanceID: string) {
    setBusy({ instanceID, action: 'test' }); setError('')
    try { await api.testTunnel(instanceID); await refresh() }
    catch (cause) { setError(messageOf(cause)) } finally { setBusy(null) }
  }

  async function disconnect() {
    setBusy({ instanceID: '', action: 'disconnect' }); setError('')
    try { await api.endPairing(); setConfig(undefined); setPairing('waiting') }
    catch (cause) { setError(messageOf(cause)) } finally { setBusy(null) }
  }

  if (pairing !== 'paired') return <PairingScreen state={pairing} message={error} />

  return <div className="min-h-dvh bg-zinc-950 text-zinc-100 [color-scheme:dark]">
    <header className="border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
        <div><p className="m-0 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-400">Wharnex Remote</p><h1 className="mt-1 text-lg font-semibold">Infraestrutura remota</h1></div>
        <div className="flex items-center gap-2">
          <button className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium hover:border-zinc-500 disabled:opacity-50" disabled={Boolean(busy)} onClick={() => void refresh().catch((cause) => setError(messageOf(cause)))}>Atualizar</button>
          <button className="rounded-lg border border-red-900/80 bg-red-950/40 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-950/70 disabled:opacity-50" disabled={Boolean(busy)} onClick={() => void disconnect()}>Terminar sessão</button>
        </div>
      </div>
    </header>
    <main className="mx-auto max-w-6xl px-5 py-8">
      <section className="mb-6 flex flex-col justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/55 p-5 sm:flex-row sm:items-center">
        <div><p className="text-sm font-medium text-zinc-400">Estado da instância</p><p className="mt-1 text-xl font-semibold">{config?.remote_input?.enabled ? 'Transporte remoto ativo' : 'Transporte remoto desativado'}</p></div>
        <div className="rounded-full border border-emerald-900 bg-emerald-950/40 px-3 py-1.5 text-xs font-semibold text-emerald-300">Emparelhado{config?.version ? ` · v${config.version}` : ''}</div>
      </section>
      {error && <div role="alert" className="mb-6 rounded-xl border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div>}
      <div className="mb-4 flex items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Túneis</p><h2 className="mt-1 text-2xl font-semibold">Instâncias publicadas</h2></div><span className="text-sm text-zinc-500">{instances.length} configurada(s)</span></div>
      {instances.length ? <div className="grid gap-4 lg:grid-cols-2">{instances.map((instance) => <TunnelCard key={instance.id} instance={instance} busy={busy} onControl={control} onTest={test} />)}</div> : <div className="rounded-2xl border border-dashed border-zinc-800 p-10 text-center text-zinc-500">Nenhuma instância de túnel configurada no Desktop.</div>}
    </main>
  </div>
}

function PairingScreen({ state, message }: { state: PairingState; message: string }) {
  const detail = state === 'checking' ? 'A confirmar se este navegador já está emparelhado.' : state === 'waiting' ? 'Abra Infraestrutura remota no Wharnex Desktop e use o link ou QR de emparelhamento do túnel.' : message || 'O código expirou ou a instância deixou de estar disponível.'
  return <main className="grid min-h-dvh place-items-center bg-zinc-950 px-5 py-10 text-zinc-100 [color-scheme:dark]"><section className="w-full max-w-xl rounded-3xl border border-zinc-800 bg-zinc-900/70 p-8 shadow-2xl"><p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-400">Wharnex Remote</p><h1 className="mt-4 text-3xl font-semibold leading-tight">Acesso remoto emparelhado, sem mover os browsers de IA.</h1><p className="mt-4 leading-7 text-zinc-400">{detail}</p><div className={`mt-7 rounded-xl border p-4 text-sm ${state === 'error' ? 'border-red-900 bg-red-950/40 text-red-200' : 'border-zinc-800 bg-zinc-950/60 text-zinc-300'}`}>{state === 'checking' ? 'A verificar sessão…' : state === 'waiting' ? 'Aguardando emparelhamento seguro.' : 'Não foi possível concluir o emparelhamento.'}</div><p className="mt-6 text-xs leading-5 text-zinc-600">O código é temporário e de uso único. A sessão remota não recebe credenciais do provedor nem autoridade adicional de execução.</p></section></main>
}

function TunnelCard({ instance, busy, onControl, onTest }: { instance: TunnelInstance; busy: BusyAction; onControl: (id: string, action: 'pause' | 'stop' | 'resume') => Promise<void>; onTest: (id: string) => Promise<void> }) {
  const state = instance.state || (instance.available ? 'active' : 'unavailable')
  const active = state === 'active'
  const working = busy?.instanceID === instance.id
  return <article className="rounded-2xl border border-zinc-800 bg-zinc-900/55 p-5">
    <div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2"><h3 className="text-lg font-semibold">{instance.id}</h3><StateBadge state={state}/></div><p className="mt-1 text-sm text-zinc-500">{instance.provider} · prioridade {instance.priority}</p></div><span className="text-xs text-zinc-600">{instance.usage.requests_in_window} req/janela</span></div>
    {instance.public_url ? <a className="mt-4 block truncate rounded-lg bg-zinc-950/70 px-3 py-2 font-mono text-xs text-cyan-300 hover:text-cyan-200" href={instance.public_url} target="_blank" rel="noreferrer">{instance.public_url}</a> : <p className="mt-4 rounded-lg bg-zinc-950/70 px-3 py-2 text-sm text-zinc-600">URL pública indisponível</p>}
    {instance.error && <p className="mt-3 text-sm text-amber-300">{instance.error}</p>}
    <div className="mt-5 flex flex-wrap gap-2">
      <Action disabled={Boolean(busy)} active={working && busy?.action === 'test'} onClick={() => void onTest(instance.id)}>Testar</Action>
      {active ? <Action disabled={Boolean(busy)} active={working && busy?.action === 'pause'} onClick={() => void onControl(instance.id, 'pause')}>Pausar</Action> : <Action disabled={Boolean(busy)} active={working && busy?.action === 'resume'} onClick={() => void onControl(instance.id, 'resume')}>Retomar</Action>}
      <Action danger disabled={Boolean(busy) || state === 'stopped'} active={working && busy?.action === 'stop'} onClick={() => void onControl(instance.id, 'stop')}>Parar</Action>
    </div>
  </article>
}

function StateBadge({ state }: { state: string }) {
  const tone = state === 'active' ? 'border-emerald-900 bg-emerald-950/50 text-emerald-300' : state === 'paused' ? 'border-amber-900 bg-amber-950/50 text-amber-300' : state === 'stopped' ? 'border-zinc-700 bg-zinc-800 text-zinc-300' : 'border-red-900 bg-red-950/50 text-red-300'
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tone}`}>{state}</span>
}

function Action({ children, disabled, active, danger = false, onClick }: { children: string; disabled: boolean; active: boolean; danger?: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${danger ? 'border-red-900/80 text-red-200 hover:bg-red-950/40' : 'border-zinc-700 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800/70'}`}>{active ? 'A processar…' : children}</button>
}
