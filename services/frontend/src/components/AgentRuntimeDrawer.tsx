import { useCallback, useEffect, useMemo, useState } from 'react'
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

export function AgentRuntimeDrawer({ onClose, onError }: { onClose: () => void; onError?: (message: string) => void }) {
  const bridge = window.wharnessDesktop?.agents
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
    <div className="agent-drawer-empty">A gestão de Supervisor e Workers está disponível no Wharness Desktop.</div>
  </section>

  return <section className="agent-runtime-drawer" aria-label="Gestão de agentes">
    <header className="agent-drawer-heading"><div><span className="panel-kicker">Runtime ChatGPT</span><strong>Agentes</strong></div><div className="agent-runtime-heading-actions"><button type="button" className="agent-drawer-icon" onClick={() => void refresh()} aria-label="Atualizar agentes"><Icon name="refresh" size={13}/></button><button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar agentes"><Icon name="close" size={13}/></button></div></header>
    {!runtime ? <div className="agent-drawer-empty">A carregar instâncias do runtime…</div> : <>
      <div className="agent-runtime-summary"><span><b>{runtime.agents.length}</b> instâncias</span><span><b>{running}</b> em execução</span><span><b>{runtime.desired_workers}</b> workers</span></div>
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
          <dl><div><dt>Chat</dt><dd>{short(selected.chat_id)}</dd></div><div><dt>Tarefa</dt><dd>{selected.task ? `${selected.task.type} · ${selected.task.task_id}` : 'Sem tarefa ativa'}</dd></div><div><dt>Pedido</dt><dd>{short(selected.task?.request_id)}</dd></div><div><dt>Estado</dt><dd>{statusLabel(selected)}{selected.error ? ` · ${selected.error}` : ''}</dd></div><div><dt>Navegador</dt><dd>{selected.browser.available ? `WebContents #${selected.browser.web_contents_id}` : 'Ainda não criado'}</dd></div><div><dt>Página</dt><dd title={selected.browser.url}>{short(selected.browser.title || selected.browser.url)}</dd></div></dl>
          <button type="button" className="agent-runtime-capture" disabled={busy || !selected.browser.available} onClick={() => void capture()}><Icon name="monitor" size={13}/> Ver instância do navegador</button>
          {snapshot?.agentId === selected.id && <figure className="agent-runtime-snapshot"><img src={snapshot.dataUrl} alt={`Captura do navegador de ${selected.label}`}/><figcaption>Capturado às {new Date(snapshot.capturedAt).toLocaleTimeString()}</figcaption></figure>}
        </div>}
      </div>
    </>}
  </section>
}
