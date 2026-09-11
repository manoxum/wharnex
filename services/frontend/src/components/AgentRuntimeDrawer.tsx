import { useCallback, useEffect, useMemo, useState } from 'react'
import { desktopBridge } from '../lib/desktop'
import { Icon } from './Icon'

type Runtime = DesktopAgentRuntimeState

type Snapshot = { agentId: string; dataUrl: string; capturedAt: string }

function statusLabel(agent: DesktopAgentRuntimeAgent) {
  if (agent.draining) return 'A terminar'
  if (agent.status === 'running') return 'Em execução'
  if (agent.status === 'error') return 'Com erro'
  if (agent.status === 'loading') return 'A carregar'
  return 'Disponível'
}

function short(value?: string, fallback = '—') {
  const text = String(value || '').trim()
  return text || fallback
}

function timeLabel(value?: string) {
  const text = String(value || '').trim()
  if (!text) return '—'
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString()
}

export function AgentRuntimeDrawer({ onClose, onError }: { onClose: () => void; onError?: (message: string) => void }) {
  const bridge = desktopBridge()?.agents
  const [runtime, setRuntime] = useState<Runtime>()
  const [selectedId, setSelectedId] = useState('supervisor')
  const [busy, setBusy] = useState(false)
  const [snapshot, setSnapshot] = useState<Snapshot>()

  const refresh = useCallback(async () => {
    if (!bridge) return
    try { setRuntime(await bridge.state()) } catch (error) { onError?.(error instanceof Error ? error.message : 'Não foi possível carregar os agentes') }
  }, [bridge, onError])

  useEffect(() => {
    if (!bridge) return
    let alive = true
    void bridge.state().then((value) => { if (alive) setRuntime(value) }).catch(() => {})
    const off = bridge.onState((value) => { if (alive) setRuntime(value) })
    const timer = window.setInterval(() => { void refresh() }, 5_000)
    return () => { alive = false; off(); window.clearInterval(timer) }
  }, [bridge, refresh])

  const selected = useMemo(() => runtime?.agents.find((agent) => agent.id === selectedId) || runtime?.agents[0], [runtime, selectedId])
  const running = runtime?.agents.filter((agent) => agent.status === 'running').length || 0

  const scaleWorkers = async (delta: number) => {
    if (!bridge || !runtime) return
    const next = Math.max(runtime.limits.min_workers, Math.min(runtime.limits.max_workers, runtime.desired_workers + delta))
    if (next === runtime.desired_workers) return
    setBusy(true)
    try { setRuntime(await bridge.setWorkerCount(next)) } catch (error) { onError?.(error instanceof Error ? error.message : 'Não foi possível escalar os workers') } finally { setBusy(false) }
  }

  const resumeProvider = async () => {
    if (!bridge) return
    setBusy(true)
    try { setRuntime(await bridge.resumeProvider()) } catch (error) { onError?.(error instanceof Error ? error.message : 'Não foi possível retomar o provider') } finally { setBusy(false) }
  }

  const capture = async () => {
    if (!bridge || !selected) return
    setBusy(true)
    try {
      const result = await bridge.snapshot(selected.id)
      setSnapshot({ agentId: selected.id, dataUrl: result.dataUrl, capturedAt: result.capturedAt })
    } catch (error) { onError?.(error instanceof Error ? error.message : 'Não foi possível capturar o navegador') } finally { setBusy(false) }
  }

  if (!bridge) return <section className="agent-runtime-drawer" aria-label="Gestão de agentes">
    <header className="agent-drawer-heading"><div><span className="panel-kicker">Runtime local</span><strong>Agentes</strong></div><button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar agentes"><Icon name="close" size={13}/></button></header>
    <div className="agent-drawer-empty"><strong>Bridge preload indisponível.</strong><span>Abra esta área no Wharness Desktop/Electron. Sem a bridge não é possível distinguir o scheduler, o backend ou os browsers dos Workers.</span></div>
  </section>

  return <section className="agent-runtime-drawer" aria-label="Gestão de agentes">
    <header className="agent-drawer-heading"><div><span className="panel-kicker">Runtime ChatGPT</span><strong>Agentes</strong></div><div className="agent-runtime-heading-actions"><button type="button" className="agent-drawer-icon" onClick={() => void refresh()} aria-label="Atualizar agentes"><Icon name="refresh" size={13}/></button><button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar agentes"><Icon name="close" size={13}/></button></div></header>
    {!runtime ? <div className="agent-drawer-empty">A carregar instâncias do runtime…</div> : <>
      <div className="agent-runtime-summary"><span><b>{runtime.agents.length}</b> instâncias</span><span><b>{running}</b> em execução</span><span><b>{runtime.desired_workers}</b> workers</span></div>
      <div className="agent-runtime-diagnostics">
        <div className="agent-runtime-diagnostic-row"><div><strong>Scheduler</strong><small>{runtime.scheduler?.backend_reachable ? (runtime.scheduler.running ? 'Online' : 'Parado') : 'Backend indisponível'}</small></div><span title={runtime.scheduler?.last_error || ''}>{runtime.scheduler?.last_error ? short(runtime.scheduler.last_error) : timeLabel(runtime.scheduler?.last_refresh_at)}</span></div>
        <div className="agent-runtime-diagnostic-row"><div><strong>Provider {runtime.provider?.provider || 'chatgpt'}</strong><small>{runtime.provider?.paused ? 'Pausado globalmente' : 'Ativo'}</small></div><div className="agent-runtime-provider-action"><span title={runtime.provider?.reason || ''}>{runtime.provider?.paused ? short(runtime.provider.reason, 'Atenção humana') : 'Sem bloqueio global'}</span>{runtime.provider?.paused && <button type="button" disabled={busy} onClick={() => void resumeProvider()}>Retomar provider</button>}</div></div>
        <div className="agent-runtime-queue"><span><b>{runtime.queue?.total || 0}</b> tarefas</span>{Object.entries(runtime.queue?.counts || {}).filter(([, count]) => count > 0).map(([state, count]) => <span key={state}><b>{count}</b> {state}</span>)}</div>
        <div className="agent-runtime-queue-times"><span>Mais antiga: {timeLabel(runtime.queue?.oldest_created_at)}</span><span>Próxima: {timeLabel(runtime.queue?.next_not_before)}</span></div>
      </div>
      <div className="agent-runtime-scale">
        <div><strong>Supervisor</strong><small>Superfície humana exclusiva</small></div><div className="agent-runtime-stepper locked"><button disabled aria-label="Diminuir supervisores">−</button><b>1</b><button disabled aria-label="Aumentar supervisores">+</button></div>
        <div><strong>Workers</strong><small>Escala sem interromper tarefas em curso</small></div><div className="agent-runtime-stepper"><button disabled={busy || runtime.desired_workers <= runtime.limits.min_workers} onClick={() => void scaleWorkers(-1)} aria-label="Diminuir workers">−</button><b>{runtime.desired_workers}</b><button disabled={busy || runtime.desired_workers >= runtime.limits.max_workers} onClick={() => void scaleWorkers(1)} aria-label="Aumentar workers">+</button></div>
      </div>
      <div className="agent-runtime-body">
        <div className="agent-runtime-list" role="list" aria-label="Instâncias de agentes">{runtime.agents.map((agent) => <button type="button" role="listitem" key={agent.id} className={selected?.id === agent.id ? 'active' : ''} onClick={() => { setSelectedId(agent.id); setSnapshot(undefined) }}>
          <span className={`agent-runtime-dot ${agent.status}`} aria-hidden="true"/><span><strong>{agent.label}</strong><small>{agent.role === 'supervisor' ? 'Supervisor' : 'Worker'} · {statusLabel(agent)}</small></span>{agent.task && <code>{agent.task.type}</code>}
        </button>)}</div>
        {selected && <div className="agent-runtime-detail">
          <div className="agent-runtime-detail-heading"><div><span className={`agent-runtime-dot ${selected.status}`} aria-hidden="true"/><strong>{selected.label}</strong></div><span>{statusLabel(selected)}</span></div>
          {(() => { const task = selected.task || selected.last_task; return <dl><div><dt>Loop</dt><dd>{selected.role === 'supervisor' ? 'Interação humana' : selected.loop_active === false ? 'Parado' : 'Ativo'}</dd></div><div><dt>Chat</dt><dd>{short(selected.chat_id)}</dd></div><div><dt>Tarefa</dt><dd>{task ? `${task.type} · ${task.task_id}${selected.task ? '' : ' · última'}` : 'Sem tarefa registada'}</dd></div><div><dt>Pedido</dt><dd>{short(task?.request_id)}</dd></div><div><dt>Lineage</dt><dd>{short(task?.root_request_id)}</dd></div><div><dt>Conversa</dt><dd>{short(task?.conversation_id)}</dd></div><div><dt>Tentativa</dt><dd>{task ? `${task.attempt}/${task.max_attempts}` : '—'}</dd></div><div><dt>Último claim</dt><dd>{timeLabel(selected.last_claim_at)}</dd></div><div><dt>Lease</dt><dd>{timeLabel(task?.lease_expires_at)}</dd></div><div><dt>not_before</dt><dd>{timeLabel(task?.not_before)}</dd></div><div><dt>Estado</dt><dd>{statusLabel(selected)}{selected.error || task?.last_error ? ` · ${selected.error || task?.last_error}` : ''}</dd></div><div><dt>Navegador</dt><dd>{selected.browser.available ? `WebContents #${selected.browser.web_contents_id}` : 'Ainda não criado'}</dd></div><div><dt>Página</dt><dd title={selected.browser.url}>{short(selected.browser.title || selected.browser.url)}</dd></div></dl> })()}
          <button type="button" className="agent-runtime-capture" disabled={busy || !selected.browser.available} onClick={() => void capture()}><Icon name="monitor" size={13}/> Ver instância do navegador</button>
          {snapshot?.agentId === selected.id && <figure className="agent-runtime-snapshot"><img src={snapshot.dataUrl} alt={`Captura do navegador de ${selected.label}`}/><figcaption>Capturado às {new Date(snapshot.capturedAt).toLocaleTimeString()}</figcaption></figure>}
        </div>}
      </div>
    </>}
  </section>
}
