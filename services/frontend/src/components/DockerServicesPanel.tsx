import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { DockerContainer, DockerContainerAction, DockerOverview, Session, TerminalRunInput } from '../types'
import { api } from '../lib/api'
import { confirmDialog } from '../lib/appDialog'
import { Icon } from './Icon'

const EMPTY_OVERVIEW: DockerOverview = { containers: [], images: [], volumes: [], networks: [], refreshed_at: '' }
const REFRESH_INTERVAL_MS = 15_000

export function DockerServicesPanel({ session, onClose, onError, onRunInTerminal }: {
  session: Session
  onClose: () => void
  onError: (message: string) => void
  onRunInTerminal?: (input: TerminalRunInput) => void
}) {
  const [overview, setOverview] = useState<DockerOverview>(EMPTY_OVERVIEW)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [selectedContainerID, setSelectedContainerID] = useState('')
  const [detailTab, setDetailTab] = useState<'overview' | 'logs'>('overview')
  const [logs, setLogs] = useState('')
  const [logsLoading, setLogsLoading] = useState(false)
  const [actionBusy, setActionBusy] = useState<DockerContainerAction | ''>('')
  const [expanded, setExpanded] = useState<Record<DockerSectionKey, boolean>>({ containers: true, images: true, volumes: true, networks: true })

  const refresh = useCallback(async (showBusy = false) => {
    if (showBusy) setLoading(true)
    try {
      const next = normalizeDockerOverview(await api.dockerOverview(session.id))
      setOverview(next)
      setLoadError('')
      setSelectedContainerID((current) => next.containers.some((item) => item.id === current) ? current : (next.containers[0]?.id || ''))
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Não foi possível consultar o Docker')
    } finally {
      if (showBusy) setLoading(false)
    }
  }, [session.id])

  useEffect(() => {
    let active = true
    setLoading(true)
    api.dockerOverview(session.id)
      .then((response) => {
        if (!active) return
        const next = normalizeDockerOverview(response)
        setOverview(next)
        setLoadError('')
        setSelectedContainerID((current) => next.containers.some((item) => item.id === current) ? current : (next.containers[0]?.id || ''))
      })
      .catch((error) => { if (active) setLoadError(error instanceof Error ? error.message : 'Não foi possível consultar o Docker') })
      .finally(() => { if (active) setLoading(false) })
    const timer = window.setInterval(() => { if (active) void refresh(false) }, REFRESH_INTERVAL_MS)
    return () => { active = false; window.clearInterval(timer) }
  }, [refresh, session.id])

  const selected = useMemo(() => overview.containers.find((container) => container.id === selectedContainerID), [overview.containers, selectedContainerID])
  const running = selected ? dockerContainerRunning(selected) : false

  async function loadLogs(container = selected) {
    if (!container) return
    setLogsLoading(true)
    try {
      const result = await api.dockerContainerLogs(session.id, container.id, 300)
      setLogs(result.content || '')
      setDetailTab('logs')
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Não foi possível carregar os logs do container')
    } finally {
      setLogsLoading(false)
    }
  }

  async function runAction(action: DockerContainerAction) {
    if (!selected || selected.protected) return
    if (action === 'stop' || action === 'restart') {
      const confirmed = await confirmDialog({
        title: action === 'stop' ? `Parar ${selected.name}` : `Reiniciar ${selected.name}`,
        message: action === 'stop' ? 'O serviço ficará indisponível até ser iniciado novamente.' : 'O container será interrompido e iniciado novamente.',
        tone: action === 'stop' ? 'warning' : 'neutral',
        confirmLabel: action === 'stop' ? 'Parar container' : 'Reiniciar',
      })
      if (!confirmed) return
    }
    setActionBusy(action)
    try {
      await api.dockerContainerAction(session.id, selected.id, action)
      await refresh(false)
      if (detailTab === 'logs') await loadLogs(selected)
    } catch (error) {
      onError(error instanceof Error ? error.message : `Não foi possível ${action} o container`)
    } finally {
      setActionBusy('')
    }
  }

  function openTerminal(container = selected) {
    if (!container || !onRunInTerminal || !dockerContainerRunning(container)) return
    onRunInTerminal({ command: `docker exec -it ${shellQuote(container.id)} sh`, cwd: '.', label: `Docker · ${container.name}` })
  }

  return <section className="docker-services-panel" aria-label="Serviços Docker">
    <header className="docker-services-header">
      <div><span className="panel-kicker">Services</span><strong>Docker</strong><small>Host local · containers, imagens, volumes e redes</small></div>
      <div className="docker-services-header-actions">
        <button type="button" onClick={() => void refresh(true)} disabled={loading} title="Atualizar Docker" aria-label="Atualizar Docker"><Icon name="refresh" size={13}/></button>
        <button type="button" onClick={onClose} title="Fechar Docker" aria-label="Fechar Docker"><Icon name="close" size={13}/></button>
      </div>
    </header>

    {loadError ? <div className="docker-services-offline"><Icon name="alert" size={16}/><div><strong>Docker indisponível</strong><span>{loadError}</span></div><button type="button" onClick={() => void refresh(true)}>Tentar novamente</button></div> : null}

    <div className="docker-services-layout">
      <div className="docker-services-tree" aria-label="Recursos Docker">
        <DockerSection label="Containers" icon="container" count={overview.containers.length} open={expanded.containers} onToggle={() => setExpanded((current) => ({ ...current, containers: !current.containers }))}>
          {overview.containers.map((container) => <button type="button" key={container.id} className={`docker-resource-row docker-container-row ${container.id === selectedContainerID ? 'active' : ''}`} onClick={() => { setSelectedContainerID(container.id); setDetailTab('overview') }}>
            <span className={`docker-state-dot state-${dockerStateTone(container.state)}`} aria-hidden="true"/>
            <span className="docker-resource-copy"><strong>{container.name || container.id}</strong><small>{container.image}</small></span>
            {container.protected ? <span className="docker-protected-mark" title="Backend Wharnex" aria-label="Backend Wharnex"><Icon name="shield" size={11}/></span> : null}
          </button>)}
          {!overview.containers.length && <DockerEmpty text="Nenhum container"/>}
        </DockerSection>
        <DockerSection label="Images" icon="image" count={overview.images.length} open={expanded.images} onToggle={() => setExpanded((current) => ({ ...current, images: !current.images }))}>
          {overview.images.map((image) => <div className="docker-resource-row" key={`${image.id}:${image.repository}:${image.tag}`}><Icon name="image" size={12}/><span className="docker-resource-copy"><strong>{image.repository}:{image.tag}</strong><small>{image.size}{image.created_since ? ` · ${image.created_since}` : ''}</small></span></div>)}
          {!overview.images.length && <DockerEmpty text="Nenhuma imagem"/>}
        </DockerSection>
        <DockerSection label="Volumes" icon="database" count={overview.volumes.length} open={expanded.volumes} onToggle={() => setExpanded((current) => ({ ...current, volumes: !current.volumes }))}>
          {overview.volumes.map((volume) => <div className="docker-resource-row" key={volume.name}><Icon name="database" size={12}/><span className="docker-resource-copy"><strong>{volume.name}</strong><small>{volume.driver}{volume.scope ? ` · ${volume.scope}` : ''}</small></span></div>)}
          {!overview.volumes.length && <DockerEmpty text="Nenhum volume"/>}
        </DockerSection>
        <DockerSection label="Networks" icon="network" count={overview.networks.length} open={expanded.networks} onToggle={() => setExpanded((current) => ({ ...current, networks: !current.networks }))}>
          {overview.networks.map((network) => <div className="docker-resource-row" key={network.id || network.name}><Icon name="network" size={12}/><span className="docker-resource-copy"><strong>{network.name}</strong><small>{network.driver}{network.internal ? ' · internal' : ''}</small></span></div>)}
          {!overview.networks.length && <DockerEmpty text="Nenhuma rede"/>}
        </DockerSection>
      </div>

      <div className="docker-services-detail">
        {selected ? <>
          <div className="docker-container-heading">
            <div className="docker-container-identity"><span className={`docker-state-dot state-${dockerStateTone(selected.state)}`}/><div><strong>{selected.name}</strong><small>{selected.id} · {selected.image}</small></div></div>
            <span className={`docker-state-pill state-${dockerStateTone(selected.state)}`}>{selected.state || 'unknown'}</span>
          </div>
          <div className="docker-container-actions" role="toolbar" aria-label={`Ações de ${selected.name}`}>
            {!running ? <button type="button" disabled={Boolean(actionBusy) || selected.protected} onClick={() => void runAction('start')}><Icon name="play" size={12}/> Start</button> : <button type="button" disabled={Boolean(actionBusy) || selected.protected} onClick={() => void runAction('stop')}><Icon name="pause" size={12}/> Stop</button>}
            <button type="button" disabled={Boolean(actionBusy) || selected.protected} onClick={() => void runAction('restart')}><Icon name="refresh" size={12}/> Restart</button>
            <button type="button" disabled={!running || !onRunInTerminal} onClick={() => openTerminal()}><Icon name="terminal" size={12}/> Terminal</button>
            <button type="button" disabled={logsLoading} onClick={() => void loadLogs()}><Icon name="list" size={12}/> Logs</button>
          </div>
          {selected.protected ? <div className="docker-protected-note"><Icon name="shield" size={12}/><span>Este é o backend que serve o Wharnex. Start/Stop/Restart ficam bloqueados aqui para não cortar a própria operação em curso.</span></div> : null}
          <nav className="docker-detail-tabs" role="tablist" aria-label="Detalhes do container">
            <button type="button" role="tab" aria-selected={detailTab === 'overview'} onClick={() => setDetailTab('overview')}>Overview</button>
            <button type="button" role="tab" aria-selected={detailTab === 'logs'} onClick={() => void loadLogs()}>Logs</button>
          </nav>
          {detailTab === 'overview' ? <div className="docker-container-overview">
            <DockerFact label="Estado" value={selected.status || selected.state}/>
            <DockerFact label="Imagem" value={selected.image}/>
            <DockerFact label="Portas" value={selected.ports || 'Sem portas publicadas'}/>
            <DockerFact label="Redes" value={selected.networks || 'Sem rede reportada'}/>
          </div> : <div className="docker-logs-view"><div className="docker-logs-toolbar"><span>Últimas 300 linhas</span><button type="button" onClick={() => void loadLogs()} disabled={logsLoading}><Icon name="refresh" size={11}/> Atualizar</button></div><pre>{logsLoading && !logs ? 'A carregar logs…' : logs || 'Sem logs disponíveis.'}</pre></div>}
        </> : <div className="docker-detail-empty"><Icon name="container" size={22}/><strong>{loading ? 'A consultar Docker…' : 'Selecione um container'}</strong><span>Escolha um container para ver estado, logs, terminal e ações de ciclo de vida.</span></div>}
      </div>
    </div>
    <footer className="docker-services-footer"><span>{overview.containers.filter(dockerContainerRunning).length} running · {overview.containers.length} containers</span><span>{overview.refreshed_at ? `Atualizado ${formatRefreshTime(overview.refreshed_at)}` : ''}</span></footer>
  </section>
}

type DockerSectionKey = 'containers' | 'images' | 'volumes' | 'networks'
type DockerSectionIcon = 'container' | 'image' | 'database' | 'network'

function DockerSection({ label, icon, count, open, onToggle, children }: { label: string; icon: DockerSectionIcon; count: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  return <section className="docker-resource-section"><button type="button" className="docker-section-heading" aria-expanded={open} onClick={onToggle}><Icon name="chevron-right" size={10}/><Icon name={icon} size={12}/><strong>{label}</strong><span>{count}</span></button>{open ? <div className="docker-section-items">{children}</div> : null}</section>
}

function normalizeDockerOverview(value: DockerOverview): DockerOverview {
  return {
    ...value,
    containers: Array.isArray(value.containers) ? value.containers : [],
    images: Array.isArray(value.images) ? value.images : [],
    volumes: Array.isArray(value.volumes) ? value.volumes : [],
    networks: Array.isArray(value.networks) ? value.networks : [],
  }
}

function DockerEmpty({ text }: { text: string }) { return <div className="docker-resource-empty">{text}</div> }
function DockerFact({ label, value }: { label: string; value: string }) { return <div className="docker-fact"><span>{label}</span><strong>{value}</strong></div> }
function dockerContainerRunning(container: DockerContainer) { return ['running', 'restarting'].includes((container.state || '').toLowerCase()) }
function dockerStateTone(state: string) { const value = (state || '').toLowerCase(); if (value === 'running') return 'running'; if (value === 'restarting') return 'warning'; if (value === 'paused') return 'warning'; return 'stopped' }
function shellQuote(value: string) { return `'${value.replace(/'/g, `'"'"'`)}'` }
function formatRefreshTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }
