import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { DockerComposeProject, DockerContainer, DockerContainerAction, DockerOverview, DockerResourceKind, Session, TerminalRunInput } from '../types'
import { api } from '../lib/api'
import { confirmDialog } from '../lib/appDialog'
import { Icon } from './Icon'

const EMPTY_OVERVIEW: DockerOverview = { compose_projects: [], containers: [], images: [], volumes: [], networks: [], refreshed_at: '' }
const REFRESH_INTERVAL_MS = 15_000
const DOCKER_FONT_SCALE_KEY = 'whx.docker.font-scale'
const DEFAULT_DOCKER_FONT_SCALE = 1.15

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
  const [composeBusy, setComposeBusy] = useState('')
  const [resourceBusy, setResourceBusy] = useState('')
  const [fontScale, setFontScale] = useState(readDockerFontScale)
  const [expanded, setExpanded] = useState<Record<DockerSectionKey, boolean>>({ compose: true, containers: true, images: true, volumes: true, networks: true })
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({})

  const acceptOverview = useCallback((response: DockerOverview) => {
    const next = normalizeDockerOverview(response)
    setOverview(next)
    setLoadError('')
    setSelectedContainerID((current) => next.containers.some((item) => item.id === current) ? current : (next.containers[0]?.id || ''))
    setExpandedProjects((current) => Object.fromEntries(next.compose_projects.map((project) => [project.name, current[project.name] ?? true])))
  }, [])

  const refresh = useCallback(async (showBusy = false) => {
    if (showBusy) setLoading(true)
    try {
      acceptOverview(await api.dockerOverview(session.id))
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Não foi possível consultar o Docker')
    } finally {
      if (showBusy) setLoading(false)
    }
  }, [acceptOverview, session.id])

  useEffect(() => {
    let active = true
    setLoading(true)
    api.dockerOverview(session.id)
      .then((response) => { if (active) acceptOverview(response) })
      .catch((error) => { if (active) setLoadError(error instanceof Error ? error.message : 'Não foi possível consultar o Docker') })
      .finally(() => { if (active) setLoading(false) })
    const timer = window.setInterval(() => { if (active) void refresh(false) }, REFRESH_INTERVAL_MS)
    return () => { active = false; window.clearInterval(timer) }
  }, [acceptOverview, refresh, session.id])

  const selected = useMemo(() => overview.containers.find((container) => container.id === selectedContainerID), [overview.containers, selectedContainerID])
  const standaloneContainers = useMemo(() => overview.containers.filter((container) => !container.compose_project), [overview.containers])
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

  async function runComposeDown(project: DockerComposeProject) {
    if (project.protected) return
    const confirmed = await confirmDialog({
      title: `Docker Compose Down · ${project.name}`,
      message: `Vai parar e remover ${project.container_count} container(s) deste Compose e remover as redes criadas pelo projeto. Volumes são preservados.`,
      tone: 'warning',
      confirmLabel: 'Executar Compose Down',
    })
    if (!confirmed) return
    setComposeBusy(project.name)
    try {
      await api.dockerComposeDown(session.id, project.name)
      await refresh(false)
    } catch (error) {
      onError(error instanceof Error ? error.message : `Não foi possível executar Compose Down em ${project.name}`)
    } finally {
      setComposeBusy('')
    }
  }

  async function removeResource(kind: DockerResourceKind, name: string, inUse: boolean) {
    if (inUse) return
    const label = kind === 'volume' ? 'volume' : 'rede'
    const confirmed = await confirmDialog({
      title: `Eliminar ${label} · ${name}`,
      message: `Esta ação elimina definitivamente ${label === 'volume' ? 'o volume e os dados armazenados nele' : 'a rede Docker'}.`,
      tone: 'warning',
      confirmLabel: `Eliminar ${label}`,
    })
    if (!confirmed) return
    const busyKey = `${kind}:${name}`
    setResourceBusy(busyKey)
    try {
      await api.dockerResourceRemove(session.id, kind, name)
      await refresh(false)
    } catch (error) {
      onError(error instanceof Error ? error.message : `Não foi possível eliminar ${label}`)
    } finally {
      setResourceBusy('')
    }
  }

  function openTerminal(container = selected) {
    if (!container || !onRunInTerminal || !dockerContainerRunning(container)) return
    onRunInTerminal({ command: `docker exec -it ${shellQuote(container.id)} sh`, cwd: '.', label: `Docker · ${container.name}` })
  }

  function changeFontScale(delta: number) {
    setFontScale((current) => {
      const next = Math.min(1.6, Math.max(0.95, Math.round((current + delta) * 100) / 100))
      window.localStorage.setItem(DOCKER_FONT_SCALE_KEY, String(next))
      return next
    })
  }

  return <section className="docker-services-panel" aria-label="Serviços Docker" style={{ '--docker-user-scale': fontScale } as CSSProperties}>
    <header className="docker-services-header">
      <div><span className="panel-kicker">Services</span><strong>Docker</strong><small>Host local · Compose, containers, imagens, volumes e redes</small></div>
      <div className="docker-services-header-actions">
        <button type="button" className="docker-font-control" onClick={() => changeFontScale(-0.1)} title="Diminuir texto" aria-label="Diminuir texto">A−</button>
        <button type="button" className="docker-font-control" onClick={() => changeFontScale(0.1)} title="Aumentar texto" aria-label="Aumentar texto">A+</button>
        <button type="button" onClick={() => void refresh(true)} disabled={loading} title="Atualizar Docker" aria-label="Atualizar Docker"><Icon name="refresh" size={13}/></button>
        <button type="button" onClick={onClose} title="Fechar Docker" aria-label="Fechar Docker"><Icon name="close" size={13}/></button>
      </div>
    </header>

    {loadError ? <div className="docker-services-offline"><Icon name="alert" size={16}/><div><strong>Docker indisponível</strong><span>{loadError}</span></div><button type="button" onClick={() => void refresh(true)}>Tentar novamente</button></div> : null}

    <div className="docker-services-layout">
      <div className="docker-services-tree" aria-label="Recursos Docker">
        <DockerSection label="Compose" icon="package" count={overview.compose_projects.length} open={expanded.compose} onToggle={() => setExpanded((current) => ({ ...current, compose: !current.compose }))}>
          {overview.compose_projects.map((project) => {
            const projectOpen = expandedProjects[project.name] ?? true
            const containers = overview.containers.filter((container) => container.compose_project === project.name)
            return <div className="docker-compose-group" key={project.name}>
              <div className="docker-compose-heading">
                <button type="button" className="docker-compose-toggle" aria-expanded={projectOpen} onClick={() => setExpandedProjects((current) => ({ ...current, [project.name]: !projectOpen }))}>
                  <Icon name="chevron-right" size={10}/>
                  <span className={`docker-state-dot state-${dockerComposeTone(project)}`} aria-hidden="true"/>
                  <span className="docker-resource-copy"><strong>{project.name}</strong><small>{composeSummary(project)}</small></span>
                </button>
                <button type="button" className="docker-compose-down" disabled={Boolean(composeBusy) || project.protected} onClick={() => void runComposeDown(project)} title={project.protected ? 'Este Compose contém o backend Wharnex' : 'Docker Compose Down'} aria-label={`Docker Compose Down ${project.name}`}><Icon name="pause" size={11}/> Down</button>
              </div>
              {projectOpen ? <div className="docker-compose-containers">{containers.map((container) => <DockerContainerRow key={container.id} container={container} active={container.id === selectedContainerID} onSelect={() => { setSelectedContainerID(container.id); setDetailTab('overview') }}/>)}</div> : null}
            </div>
          })}
          {!overview.compose_projects.length && <DockerEmpty text="Nenhum projeto Compose detetado"/>}
        </DockerSection>

        <DockerSection label="Containers soltos" icon="container" count={standaloneContainers.length} open={expanded.containers} onToggle={() => setExpanded((current) => ({ ...current, containers: !current.containers }))}>
          {standaloneContainers.map((container) => <DockerContainerRow key={container.id} container={container} active={container.id === selectedContainerID} onSelect={() => { setSelectedContainerID(container.id); setDetailTab('overview') }}/>) }
          {!standaloneContainers.length && <DockerEmpty text="Todos os containers pertencem a um Compose"/>}
        </DockerSection>

        <DockerSection label="Images" icon="image" count={overview.images.length} open={expanded.images} onToggle={() => setExpanded((current) => ({ ...current, images: !current.images }))}>
          {overview.images.map((image) => <div className="docker-resource-row" key={`${image.id}:${image.repository}:${image.tag}`}><Icon name="image" size={13}/><span className="docker-resource-copy"><strong>{image.repository}:{image.tag}</strong><small>{image.size}{image.created_since ? ` · ${image.created_since}` : ''}</small></span><DockerUsageBadge inUse={Boolean(image.in_use)} count={image.container_count}/></div>)}
          {!overview.images.length && <DockerEmpty text="Nenhuma imagem"/>}
        </DockerSection>

        <DockerSection label="Volumes" icon="database" count={overview.volumes.length} open={expanded.volumes} onToggle={() => setExpanded((current) => ({ ...current, volumes: !current.volumes }))}>
          {overview.volumes.map((volume) => <div className="docker-resource-row" key={volume.name}><Icon name="database" size={13}/><span className="docker-resource-copy"><strong>{volume.name}</strong><small>{volume.driver}{volume.scope ? ` · ${volume.scope}` : ''}</small></span><DockerUsageBadge inUse={Boolean(volume.in_use)} count={volume.container_count}/><button type="button" className="docker-inline-action danger" disabled={Boolean(volume.in_use) || Boolean(resourceBusy)} onClick={() => void removeResource('volume', volume.name, Boolean(volume.in_use))} title={volume.in_use ? 'Volume em uso' : 'Eliminar volume'} aria-label={`Eliminar volume ${volume.name}`}><Icon name="trash" size={12}/></button></div>)}
          {!overview.volumes.length && <DockerEmpty text="Nenhum volume"/>}
        </DockerSection>

        <DockerSection label="Networks" icon="network" count={overview.networks.length} open={expanded.networks} onToggle={() => setExpanded((current) => ({ ...current, networks: !current.networks }))}>
          {overview.networks.map((network) => {
            const builtIn = ['bridge', 'host', 'none'].includes(network.name)
            return <div className="docker-resource-row" key={network.id || network.name}><Icon name="network" size={13}/><span className="docker-resource-copy"><strong>{network.name}</strong><small>{network.driver}{network.internal ? ' · internal' : ''}{builtIn ? ' · sistema' : ''}</small></span><DockerUsageBadge inUse={Boolean(network.in_use)} count={network.container_count}/><button type="button" className="docker-inline-action danger" disabled={Boolean(network.in_use) || builtIn || Boolean(resourceBusy)} onClick={() => void removeResource('network', network.name, Boolean(network.in_use))} title={builtIn ? 'Rede Docker do sistema' : network.in_use ? 'Rede em uso' : 'Eliminar rede'} aria-label={`Eliminar rede ${network.name}`}><Icon name="trash" size={12}/></button></div>
          })}
          {!overview.networks.length && <DockerEmpty text="Nenhuma rede"/>}
        </DockerSection>
      </div>

      <div className="docker-services-detail">
        {selected ? <>
          <div className="docker-container-heading">
            <div className="docker-container-identity"><span className={`docker-state-dot state-${dockerStateTone(dockerCondition(selected))}`}/><div><strong>{selected.name}</strong><small>{selected.id} · {selected.image}</small></div></div>
            <span className={`docker-state-pill state-${dockerStateTone(dockerCondition(selected))}`}>{dockerConditionLabel(dockerCondition(selected))}</span>
          </div>
          <div className="docker-container-actions" role="toolbar" aria-label={`Ações de ${selected.name}`}>
            {!running ? <button type="button" disabled={Boolean(actionBusy) || selected.protected} onClick={() => void runAction('start')}><Icon name="play" size={12}/> Start</button> : <button type="button" disabled={Boolean(actionBusy) || selected.protected} onClick={() => void runAction('stop')}><Icon name="pause" size={12}/> Stop</button>}
            <button type="button" disabled={Boolean(actionBusy) || selected.protected} onClick={() => void runAction('restart')}><Icon name="refresh" size={12}/> Restart</button>
            <button type="button" disabled={!running || !onRunInTerminal} onClick={() => openTerminal()}><Icon name="terminal" size={12}/> Terminal</button>
            <button type="button" disabled={logsLoading} onClick={() => void loadLogs()}><Icon name="list" size={12}/> Logs</button>
          </div>
          {selected.protected ? <div className="docker-protected-note"><Icon name="shield" size={12}/><span>Este é o backend que serve o Wharnex. Start/Stop/Restart e Compose Down ficam bloqueados para não cortar a própria operação em curso.</span></div> : null}
          <nav className="docker-detail-tabs" role="tablist" aria-label="Detalhes do container">
            <button type="button" role="tab" aria-selected={detailTab === 'overview'} onClick={() => setDetailTab('overview')}>Overview</button>
            <button type="button" role="tab" aria-selected={detailTab === 'logs'} onClick={() => void loadLogs()}>Logs</button>
          </nav>
          {detailTab === 'overview' ? <div className="docker-container-overview">
            <DockerFact label="Condição" value={dockerConditionLabel(dockerCondition(selected))}/>
            <DockerFact label="Estado Docker" value={selected.status || selected.state}/>
            <DockerFact label="Compose" value={selected.compose_project ? `${selected.compose_project}${selected.compose_service ? ` / ${selected.compose_service}` : ''}` : 'Container independente'}/>
            <DockerFact label="Imagem" value={selected.image}/>
            <DockerFact label="Portas" value={selected.ports || 'Sem portas publicadas'}/>
            <DockerFact label="Redes" value={selected.networks || 'Sem rede reportada'}/>
            {selected.error ? <DockerFact label="Erro" value={selected.error}/> : null}
            {selected.exit_code ? <DockerFact label="Exit code" value={String(selected.exit_code)}/> : null}
          </div> : <div className="docker-logs-view"><div className="docker-logs-toolbar"><span>Últimas 300 linhas</span><button type="button" onClick={() => void loadLogs()} disabled={logsLoading}><Icon name="refresh" size={11}/> Atualizar</button></div><pre>{logsLoading && !logs ? 'A carregar logs…' : logs || 'Sem logs disponíveis.'}</pre></div>}
        </> : <div className="docker-detail-empty"><Icon name="container" size={22}/><strong>{loading ? 'A consultar Docker…' : 'Selecione um container'}</strong><span>Escolha um container dentro de um Compose ou da lista de containers soltos para ver estado, logs, terminal e ações de ciclo de vida.</span></div>}
      </div>
    </div>
    <footer className="docker-services-footer"><span>{overview.containers.filter(dockerContainerRunning).length} running · {overview.containers.filter((item) => dockerCondition(item) === 'error').length} erro · {overview.containers.length} containers</span><span>{overview.refreshed_at ? `Atualizado ${formatRefreshTime(overview.refreshed_at)}` : ''}</span></footer>
  </section>
}

type DockerSectionKey = 'compose' | 'containers' | 'images' | 'volumes' | 'networks'
type DockerSectionIcon = 'package' | 'container' | 'image' | 'database' | 'network'

function DockerSection({ label, icon, count, open, onToggle, children }: { label: string; icon: DockerSectionIcon; count: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  return <section className="docker-resource-section"><button type="button" className="docker-section-heading" aria-expanded={open} onClick={onToggle}><Icon name="chevron-right" size={10}/><Icon name={icon} size={13}/><strong>{label}</strong><span>{count}</span></button>{open ? <div className="docker-section-items">{children}</div> : null}</section>
}

function DockerContainerRow({ container, active, onSelect }: { container: DockerContainer; active: boolean; onSelect: () => void }) {
  const condition = dockerCondition(container)
  return <button type="button" className={`docker-resource-row docker-container-row ${active ? 'active' : ''}`} onClick={onSelect}>
    <span className={`docker-state-dot state-${dockerStateTone(condition)}`} aria-hidden="true"/>
    <span className="docker-resource-copy"><strong>{container.name || container.id}</strong><small>{container.compose_service ? `${container.compose_service} · ` : ''}{container.image}</small></span>
    <span className={`docker-row-state state-${dockerStateTone(condition)}`}>{dockerConditionLabel(condition)}</span>
    {container.protected ? <span className="docker-protected-mark" title="Backend Wharnex" aria-label="Backend Wharnex"><Icon name="shield" size={11}/></span> : null}
  </button>
}

function DockerUsageBadge({ inUse, count = 0 }: { inUse: boolean; count?: number }) {
  return <span className={`docker-usage-badge ${inUse ? 'in-use' : 'free'}`}>{inUse ? `Em uso${count > 0 ? ` · ${count}` : ''}` : 'Livre'}</span>
}

function normalizeDockerOverview(value: DockerOverview): DockerOverview {
  return {
    ...value,
    compose_projects: Array.isArray(value.compose_projects) ? value.compose_projects : [],
    containers: Array.isArray(value.containers) ? value.containers : [],
    images: Array.isArray(value.images) ? value.images : [],
    volumes: Array.isArray(value.volumes) ? value.volumes : [],
    networks: Array.isArray(value.networks) ? value.networks : [],
  }
}

function DockerEmpty({ text }: { text: string }) { return <div className="docker-resource-empty">{text}</div> }
function DockerFact({ label, value }: { label: string; value: string }) { return <div className="docker-fact"><span>{label}</span><strong>{value}</strong></div> }
function dockerCondition(container: DockerContainer) { return (container.condition || container.state || 'stopped').toLowerCase() }
function dockerContainerRunning(container: DockerContainer) { return ['running', 'restarting'].includes(dockerCondition(container)) }
function dockerStateTone(state: string) { const value = (state || '').toLowerCase(); if (value === 'running') return 'running'; if (value === 'error' || value === 'dead') return 'error'; if (value === 'restarting' || value === 'paused') return 'warning'; return 'stopped' }
function dockerConditionLabel(state: string) { const value = (state || '').toLowerCase(); if (value === 'running') return 'A correr'; if (value === 'error' || value === 'dead') return 'Erro'; if (value === 'restarting') return 'A reiniciar'; if (value === 'paused') return 'Pausado'; if (value === 'created') return 'Criado'; return 'Parado' }
function dockerComposeTone(project: DockerComposeProject) { if (project.error_count > 0) return 'error'; if (project.container_count > 0 && project.running_count === project.container_count) return 'running'; if (project.running_count > 0) return 'warning'; return 'stopped' }
function composeSummary(project: DockerComposeProject) { return `${project.running_count}/${project.container_count} running${project.error_count ? ` · ${project.error_count} erro` : ''}` }
function readDockerFontScale() { const value = Number(window.localStorage.getItem(DOCKER_FONT_SCALE_KEY)); return Number.isFinite(value) && value >= 0.95 && value <= 1.6 ? value : DEFAULT_DOCKER_FONT_SCALE }
function shellQuote(value: string) { return `'${value.replace(/'/g, `'"'"'`)}'` }
function formatRefreshTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }
