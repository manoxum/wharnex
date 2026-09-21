import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { DockerComposeProject, DockerContainer, DockerContainerAction, DockerImage, DockerNetwork, DockerOverview, DockerResourceKind, DockerVolume, Session, TerminalRunInput } from '../types'
import { api } from '../lib/api'
import { confirmDialog } from '../lib/appDialog'
import { Icon } from './Icon'

const EMPTY_OVERVIEW: DockerOverview = { compose_projects: [], containers: [], images: [], volumes: [], networks: [], refreshed_at: '' }
const REFRESH_INTERVAL_MS = 15_000
const DOCKER_FONT_SCALE_KEY = 'whx.docker.font-scale'
const DEFAULT_DOCKER_FONT_SCALE = 1.15

type DockerSelectionKind = 'container' | 'image' | 'volume' | 'network'
type DockerSelection = { kind: DockerSelectionKind; key: string }

export function DockerServicesPanel({ session, onClose, onError, onRunInTerminal }: {
  session: Session
  onClose: () => void
  onError: (message: string) => void
  onRunInTerminal?: (input: TerminalRunInput) => void
}) {
  const [overview, setOverview] = useState<DockerOverview>(EMPTY_OVERVIEW)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [selection, setSelection] = useState<DockerSelection | null>(null)
  const [filterText, setFilterText] = useState('')
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
    setSelection((current) => current && dockerSelectionExists(next, current) ? current : firstDockerSelection(next))
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

  const normalizedFilter = filterText.trim().toLocaleLowerCase()
  const selectedContainer = useMemo(() => selection?.kind === 'container' ? overview.containers.find((container) => container.id === selection.key) : undefined, [overview.containers, selection])
  const selectedImage = useMemo(() => selection?.kind === 'image' ? overview.images.find((image) => dockerImageKey(image) === selection.key) : undefined, [overview.images, selection])
  const selectedVolume = useMemo(() => selection?.kind === 'volume' ? overview.volumes.find((volume) => volume.name === selection.key) : undefined, [overview.volumes, selection])
  const selectedNetwork = useMemo(() => selection?.kind === 'network' ? overview.networks.find((network) => dockerNetworkKey(network) === selection.key) : undefined, [overview.networks, selection])
  const running = selectedContainer ? dockerContainerRunning(selectedContainer) : false

  const filtered = useMemo(() => {
    const projectMatches = new Map(overview.compose_projects.map((project) => [project.name, dockerComposeMatches(project, normalizedFilter)]))
    const containers = overview.containers.filter((container) => dockerContainerMatches(container, normalizedFilter))
    const composeProjects = overview.compose_projects.filter((project) => projectMatches.get(project.name) || overview.containers.some((container) => container.compose_project === project.name && dockerContainerMatches(container, normalizedFilter)))
    const standaloneContainers = overview.containers.filter((container) => !container.compose_project && dockerContainerMatches(container, normalizedFilter))
    const images = overview.images.filter((image) => dockerImageMatches(image, normalizedFilter))
    const volumes = overview.volumes.filter((volume) => dockerVolumeMatches(volume, normalizedFilter))
    const networks = overview.networks.filter((network) => dockerNetworkMatches(network, normalizedFilter))
    return { projectMatches, containers, composeProjects, standaloneContainers, images, volumes, networks }
  }, [normalizedFilter, overview])

  const visibleCount = filtered.composeProjects.length + filtered.containers.length + filtered.images.length + filtered.volumes.length + filtered.networks.length

  async function loadLogs(container = selectedContainer) {
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
    if (!selectedContainer || selectedContainer.protected) return
    if (action === 'stop' || action === 'restart') {
      const confirmed = await confirmDialog({
        title: action === 'stop' ? `Parar ${selectedContainer.name}` : `Reiniciar ${selectedContainer.name}`,
        message: action === 'stop' ? 'O serviço ficará indisponível até ser iniciado novamente.' : 'O container será interrompido e iniciado novamente.',
        tone: action === 'stop' ? 'warning' : 'neutral',
        confirmLabel: action === 'stop' ? 'Parar container' : 'Reiniciar',
      })
      if (!confirmed) return
    }
    setActionBusy(action)
    try {
      await api.dockerContainerAction(session.id, selectedContainer.id, action)
      await refresh(false)
      if (detailTab === 'logs') await loadLogs(selectedContainer)
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

  function selectResource(next: DockerSelection) {
    setSelection(next)
    if (next.kind === 'container') setDetailTab('overview')
  }

  function openTerminal(container = selectedContainer) {
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

    <div className="docker-resource-filter">
      <Icon name="search" size={13}/>
      <input value={filterText} onChange={(event) => setFilterText(event.target.value)} aria-label="Filtrar recursos Docker" placeholder="Filtrar Compose, containers, imagens, volumes e redes…" spellCheck={false}/>
      {filterText ? <button type="button" onClick={() => setFilterText('')} title="Limpar filtro" aria-label="Limpar filtro"><Icon name="close" size={11}/></button> : null}
      <span>{normalizedFilter ? `${visibleCount} resultado${visibleCount === 1 ? '' : 's'}` : 'Todos'}</span>
    </div>

    <div className="docker-services-layout">
      <div className="docker-services-tree" aria-label="Recursos Docker">
        <DockerSection label="Compose" icon="package" count={filtered.composeProjects.length} open={Boolean(normalizedFilter) || expanded.compose} onToggle={() => setExpanded((current) => ({ ...current, compose: !current.compose }))}>
          {filtered.composeProjects.map((project) => {
            const projectOpen = Boolean(normalizedFilter) || (expandedProjects[project.name] ?? true)
            const showAllProjectContainers = Boolean(filtered.projectMatches.get(project.name))
            const containers = overview.containers.filter((container) => container.compose_project === project.name && (showAllProjectContainers || dockerContainerMatches(container, normalizedFilter)))
            return <div className="docker-compose-group" key={project.name}>
              <div className="docker-compose-heading">
                <button type="button" className="docker-compose-toggle" aria-expanded={projectOpen} onClick={() => setExpandedProjects((current) => ({ ...current, [project.name]: !projectOpen }))}>
                  <Icon name="chevron-right" size={10}/>
                  <span className={`docker-state-dot state-${dockerComposeTone(project)}`} aria-hidden="true"/>
                  <span className="docker-resource-copy"><strong>{project.name}</strong><small>{composeSummary(project)}</small></span>
                </button>
                <button type="button" className="docker-compose-down" disabled={Boolean(composeBusy) || project.protected} onClick={() => void runComposeDown(project)} title={project.protected ? 'Este Compose contém o backend Wharnex' : 'Docker Compose Down'} aria-label={`Docker Compose Down ${project.name}`}><Icon name="pause" size={11}/> Down</button>
              </div>
              {projectOpen ? <div className="docker-compose-containers">{containers.map((container) => <DockerContainerRow key={container.id} container={container} active={selection?.kind === 'container' && selection.key === container.id} onSelect={() => selectResource({ kind: 'container', key: container.id })}/>)}</div> : null}
            </div>
          })}
          {!filtered.composeProjects.length && <DockerEmpty text={normalizedFilter ? 'Nenhum Compose corresponde ao filtro' : 'Nenhum projeto Compose detetado'}/>}
        </DockerSection>

        <DockerSection label="Containers soltos" icon="container" count={filtered.standaloneContainers.length} open={Boolean(normalizedFilter) || expanded.containers} onToggle={() => setExpanded((current) => ({ ...current, containers: !current.containers }))}>
          {filtered.standaloneContainers.map((container) => <DockerContainerRow key={container.id} container={container} active={selection?.kind === 'container' && selection.key === container.id} onSelect={() => selectResource({ kind: 'container', key: container.id })}/>) }
          {!filtered.standaloneContainers.length && <DockerEmpty text={normalizedFilter ? 'Nenhum container independente corresponde ao filtro' : 'Todos os containers pertencem a um Compose'}/>}
        </DockerSection>

        <DockerSection label="Images" icon="image" count={filtered.images.length} open={Boolean(normalizedFilter) || expanded.images} onToggle={() => setExpanded((current) => ({ ...current, images: !current.images }))}>
          {filtered.images.map((image) => <DockerResourceRow key={dockerImageKey(image)} icon="image" title={`${image.repository}:${image.tag}`} subtitle={`${image.size}${image.created_since ? ` · ${image.created_since}` : ''}`} active={selection?.kind === 'image' && selection.key === dockerImageKey(image)} selectLabel={`Ver detalhes da imagem ${image.repository}:${image.tag}`} onSelect={() => selectResource({ kind: 'image', key: dockerImageKey(image) })} usage={<DockerUsageBadge inUse={Boolean(image.in_use)} count={image.container_count}/>}/>) }
          {!filtered.images.length && <DockerEmpty text={normalizedFilter ? 'Nenhuma imagem corresponde ao filtro' : 'Nenhuma imagem'}/>}
        </DockerSection>

        <DockerSection label="Volumes" icon="database" count={filtered.volumes.length} open={Boolean(normalizedFilter) || expanded.volumes} onToggle={() => setExpanded((current) => ({ ...current, volumes: !current.volumes }))}>
          {filtered.volumes.map((volume) => <DockerResourceRow key={volume.name} icon="database" title={volume.name} subtitle={`${volume.driver}${volume.scope ? ` · ${volume.scope}` : ''}`} active={selection?.kind === 'volume' && selection.key === volume.name} selectLabel={`Ver detalhes do volume ${volume.name}`} onSelect={() => selectResource({ kind: 'volume', key: volume.name })} usage={<DockerUsageBadge inUse={Boolean(volume.in_use)} count={volume.container_count}/>} action={<button type="button" className="docker-inline-action danger" disabled={Boolean(volume.in_use) || Boolean(resourceBusy)} onClick={() => void removeResource('volume', volume.name, Boolean(volume.in_use))} title={volume.in_use ? 'Volume em uso' : 'Eliminar volume'} aria-label={`Eliminar volume ${volume.name}`}><Icon name="trash" size={12}/></button>}/>) }
          {!filtered.volumes.length && <DockerEmpty text={normalizedFilter ? 'Nenhum volume corresponde ao filtro' : 'Nenhum volume'}/>}
        </DockerSection>

        <DockerSection label="Networks" icon="network" count={filtered.networks.length} open={Boolean(normalizedFilter) || expanded.networks} onToggle={() => setExpanded((current) => ({ ...current, networks: !current.networks }))}>
          {filtered.networks.map((network) => {
            const builtIn = dockerNetworkBuiltIn(network)
            return <DockerResourceRow key={dockerNetworkKey(network)} icon="network" title={network.name} subtitle={`${network.driver}${network.internal ? ' · internal' : ''}${builtIn ? ' · sistema' : ''}`} active={selection?.kind === 'network' && selection.key === dockerNetworkKey(network)} selectLabel={`Ver detalhes da rede ${network.name}`} onSelect={() => selectResource({ kind: 'network', key: dockerNetworkKey(network) })} usage={<DockerUsageBadge inUse={Boolean(network.in_use)} count={network.container_count}/>} action={<button type="button" className="docker-inline-action danger" disabled={Boolean(network.in_use) || builtIn || Boolean(resourceBusy)} onClick={() => void removeResource('network', network.name, Boolean(network.in_use))} title={builtIn ? 'Rede Docker do sistema' : network.in_use ? 'Rede em uso' : 'Eliminar rede'} aria-label={`Eliminar rede ${network.name}`}><Icon name="trash" size={12}/></button>}/>
          })}
          {!filtered.networks.length && <DockerEmpty text={normalizedFilter ? 'Nenhuma rede corresponde ao filtro' : 'Nenhuma rede'}/>}
        </DockerSection>
      </div>

      <div className="docker-services-detail">
        {selectedContainer ? <DockerContainerDetail container={selectedContainer} running={running} detailTab={detailTab} logs={logs} logsLoading={logsLoading} actionBusy={actionBusy} onRunAction={runAction} onOpenTerminal={openTerminal} onLoadLogs={loadLogs} onSelectTab={setDetailTab} hasTerminal={Boolean(onRunInTerminal)}/> : null}
        {selectedImage ? <DockerImageDetail image={selectedImage}/> : null}
        {selectedVolume ? <DockerVolumeDetail volume={selectedVolume} resourceBusy={Boolean(resourceBusy)} onRemove={() => void removeResource('volume', selectedVolume.name, Boolean(selectedVolume.in_use))}/> : null}
        {selectedNetwork ? <DockerNetworkDetail network={selectedNetwork} resourceBusy={Boolean(resourceBusy)} onRemove={() => void removeResource('network', selectedNetwork.name, Boolean(selectedNetwork.in_use))}/> : null}
        {!selectedContainer && !selectedImage && !selectedVolume && !selectedNetwork ? <div className="docker-detail-empty"><Icon name="container" size={22}/><strong>{loading ? 'A consultar Docker…' : 'Selecione um recurso'}</strong><span>Escolha um container, imagem, volume ou rede para ver informação detalhada e as ações disponíveis.</span></div> : null}
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
  return <button type="button" className={`docker-resource-row docker-container-row ${active ? 'active' : ''}`} onClick={onSelect} aria-label={`Ver detalhes do container ${container.name || container.id}`}>
    <span className={`docker-state-dot state-${dockerStateTone(condition)}`} aria-hidden="true"/>
    <span className="docker-resource-copy"><strong>{container.name || container.id}</strong><small>{container.compose_service ? `${container.compose_service} · ` : ''}{container.image}</small></span>
    <span className={`docker-row-state state-${dockerStateTone(condition)}`}>{dockerConditionLabel(condition)}</span>
    {container.protected ? <span className="docker-protected-mark" title="Backend Wharnex" aria-label="Backend Wharnex"><Icon name="shield" size={11}/></span> : null}
  </button>
}

function DockerResourceRow({ icon, title, subtitle, active, selectLabel, onSelect, usage, action }: { icon: DockerSectionIcon; title: string; subtitle: string; active: boolean; selectLabel: string; onSelect: () => void; usage: ReactNode; action?: ReactNode }) {
  return <div className={`docker-resource-row docker-detail-resource-row ${active ? 'active' : ''}`}>
    <button type="button" className="docker-resource-select" onClick={onSelect} aria-label={selectLabel}>
      <Icon name={icon} size={13}/><span className="docker-resource-copy"><strong>{title}</strong><small>{subtitle}</small></span>{usage}
    </button>
    {action}
  </div>
}

function DockerContainerDetail({ container, running, detailTab, logs, logsLoading, actionBusy, onRunAction, onOpenTerminal, onLoadLogs, onSelectTab, hasTerminal }: {
  container: DockerContainer
  running: boolean
  detailTab: 'overview' | 'logs'
  logs: string
  logsLoading: boolean
  actionBusy: DockerContainerAction | ''
  onRunAction: (action: DockerContainerAction) => Promise<void>
  onOpenTerminal: (container?: DockerContainer) => void
  onLoadLogs: (container?: DockerContainer) => Promise<void>
  onSelectTab: (tab: 'overview' | 'logs') => void
  hasTerminal: boolean
}) {
  const condition = dockerCondition(container)
  return <>
    <DockerDetailHeading icon="container" title={container.name} subtitle={`${container.id} · ${container.image}`} badge={<span className={`docker-state-pill state-${dockerStateTone(condition)}`}>{dockerConditionLabel(condition)}</span>}/>
    <div className="docker-container-actions" role="toolbar" aria-label={`Ações de ${container.name}`}>
      {!running ? <button type="button" disabled={Boolean(actionBusy) || container.protected} onClick={() => void onRunAction('start')}><Icon name="play" size={12}/> Start</button> : <button type="button" disabled={Boolean(actionBusy) || container.protected} onClick={() => void onRunAction('stop')}><Icon name="pause" size={12}/> Stop</button>}
      <button type="button" disabled={Boolean(actionBusy) || container.protected} onClick={() => void onRunAction('restart')}><Icon name="refresh" size={12}/> Restart</button>
      <button type="button" disabled={!running || !hasTerminal} onClick={() => onOpenTerminal(container)}><Icon name="terminal" size={12}/> Terminal</button>
      <button type="button" disabled={logsLoading} onClick={() => void onLoadLogs(container)}><Icon name="list" size={12}/> Logs</button>
    </div>
    {container.protected ? <div className="docker-protected-note"><Icon name="shield" size={12}/><span>Este é o backend que serve o Wharnex. Start/Stop/Restart e Compose Down ficam bloqueados para não cortar a própria operação em curso.</span></div> : null}
    <nav className="docker-detail-tabs" role="tablist" aria-label="Detalhes do container">
      <button type="button" role="tab" aria-selected={detailTab === 'overview'} onClick={() => onSelectTab('overview')}>Overview</button>
      <button type="button" role="tab" aria-selected={detailTab === 'logs'} onClick={() => void onLoadLogs(container)}>Logs</button>
    </nav>
    {detailTab === 'overview' ? <div className="docker-container-overview">
      <DockerFact label="Condição" value={dockerConditionLabel(condition)}/>
      <DockerFact label="Estado Docker" value={container.status || container.state}/>
      <DockerFact label="Compose" value={container.compose_project ? `${container.compose_project}${container.compose_service ? ` / ${container.compose_service}` : ''}` : 'Container independente'}/>
      <DockerFact label="Imagem" value={container.image}/>
      <DockerFact label="Portas" value={container.ports || 'Sem portas publicadas'}/>
      <DockerFact label="Redes" value={container.networks || 'Sem rede reportada'}/>
      {container.error ? <DockerFact label="Erro" value={container.error}/> : null}
      {container.exit_code ? <DockerFact label="Exit code" value={String(container.exit_code)}/> : null}
    </div> : <div className="docker-logs-view"><div className="docker-logs-toolbar"><span>Últimas 300 linhas</span><button type="button" onClick={() => void onLoadLogs(container)} disabled={logsLoading}><Icon name="refresh" size={11}/> Atualizar</button></div><pre>{logsLoading && !logs ? 'A carregar logs…' : logs || 'Sem logs disponíveis.'}</pre></div>}
  </>
}

function DockerImageDetail({ image }: { image: DockerImage }) {
  const name = `${image.repository}:${image.tag}`
  return <>
    <DockerDetailHeading icon="image" title={name} subtitle="Imagem Docker" badge={<DockerUsageBadge inUse={Boolean(image.in_use)} count={image.container_count}/>}/>
    <div className="docker-container-overview">
      <DockerFact label="Repository" value={image.repository || '<none>'}/>
      <DockerFact label="Tag" value={image.tag || '<none>'}/>
      <DockerFact label="Image ID" value={image.id}/>
      <DockerFact label="Tamanho" value={image.size || 'Não reportado'}/>
      <DockerFact label="Criada" value={image.created_since || 'Não reportado'}/>
      <DockerFact label="Utilização" value={dockerUsageDescription(Boolean(image.in_use), image.container_count)}/>
    </div>
  </>
}

function DockerVolumeDetail({ volume, resourceBusy, onRemove }: { volume: DockerVolume; resourceBusy: boolean; onRemove: () => void }) {
  return <>
    <DockerDetailHeading icon="database" title={volume.name} subtitle="Volume Docker" badge={<DockerUsageBadge inUse={Boolean(volume.in_use)} count={volume.container_count}/>}/>
    <div className="docker-container-actions" role="toolbar" aria-label={`Ações do volume ${volume.name}`}>
      <button type="button" className="danger" disabled={Boolean(volume.in_use) || resourceBusy} onClick={onRemove}><Icon name="trash" size={12}/> Eliminar volume</button>
    </div>
    <div className="docker-container-overview">
      <DockerFact label="Nome" value={volume.name}/>
      <DockerFact label="Driver" value={volume.driver || 'Não reportado'}/>
      <DockerFact label="Scope" value={volume.scope || 'Não reportado'}/>
      <DockerFact label="Mountpoint" value={volume.mountpoint || 'Não reportado'}/>
      <DockerFact label="Utilização" value={dockerUsageDescription(Boolean(volume.in_use), volume.container_count)}/>
    </div>
  </>
}

function DockerNetworkDetail({ network, resourceBusy, onRemove }: { network: DockerNetwork; resourceBusy: boolean; onRemove: () => void }) {
  const builtIn = dockerNetworkBuiltIn(network)
  return <>
    <DockerDetailHeading icon="network" title={network.name} subtitle="Rede Docker" badge={<DockerUsageBadge inUse={Boolean(network.in_use)} count={network.container_count}/>}/>
    <div className="docker-container-actions" role="toolbar" aria-label={`Ações da rede ${network.name}`}>
      <button type="button" className="danger" disabled={Boolean(network.in_use) || builtIn || resourceBusy} onClick={onRemove}><Icon name="trash" size={12}/> Eliminar rede</button>
    </div>
    <div className="docker-container-overview">
      <DockerFact label="Nome" value={network.name}/>
      <DockerFact label="Network ID" value={network.id || 'Não reportado'}/>
      <DockerFact label="Driver" value={network.driver || 'Não reportado'}/>
      <DockerFact label="Scope" value={network.scope || 'Não reportado'}/>
      <DockerFact label="Rede interna" value={network.internal ? 'Sim' : 'Não'}/>
      <DockerFact label="Sistema" value={builtIn ? 'Rede Docker integrada' : 'Rede criada pelo utilizador/Compose'}/>
      <DockerFact label="Utilização" value={dockerUsageDescription(Boolean(network.in_use), network.container_count)}/>
    </div>
  </>
}

function DockerDetailHeading({ icon, title, subtitle, badge }: { icon: DockerSectionIcon; title: string; subtitle: string; badge: ReactNode }) {
  return <div className="docker-container-heading"><div className="docker-container-identity"><span className="docker-detail-icon"><Icon name={icon} size={15}/></span><div><strong>{title}</strong><small>{subtitle}</small></div></div>{badge}</div>
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

function firstDockerSelection(overview: DockerOverview): DockerSelection | null {
  if (overview.containers[0]) return { kind: 'container', key: overview.containers[0].id }
  if (overview.images[0]) return { kind: 'image', key: dockerImageKey(overview.images[0]) }
  if (overview.volumes[0]) return { kind: 'volume', key: overview.volumes[0].name }
  if (overview.networks[0]) return { kind: 'network', key: dockerNetworkKey(overview.networks[0]) }
  return null
}

function dockerSelectionExists(overview: DockerOverview, selection: DockerSelection) {
  if (selection.kind === 'container') return overview.containers.some((container) => container.id === selection.key)
  if (selection.kind === 'image') return overview.images.some((image) => dockerImageKey(image) === selection.key)
  if (selection.kind === 'volume') return overview.volumes.some((volume) => volume.name === selection.key)
  return overview.networks.some((network) => dockerNetworkKey(network) === selection.key)
}

function dockerMatches(query: string, ...values: Array<string | number | boolean | undefined>) {
  if (!query) return true
  return values.some((value) => String(value ?? '').toLocaleLowerCase().includes(query))
}

function dockerComposeMatches(project: DockerComposeProject, query: string) { return dockerMatches(query, project.name, project.container_count, project.running_count, project.error_count, project.stopped_count) }
function dockerContainerMatches(container: DockerContainer, query: string) { return dockerMatches(query, container.id, container.name, container.image, container.state, container.condition, container.status, container.ports, container.networks, container.compose_project, container.compose_service, container.exit_code, container.error) }
function dockerImageMatches(image: DockerImage, query: string) { return dockerMatches(query, image.id, image.repository, image.tag, image.size, image.created_since, image.in_use ? 'em uso' : 'livre', image.container_count) }
function dockerVolumeMatches(volume: DockerVolume, query: string) { return dockerMatches(query, volume.name, volume.driver, volume.mountpoint, volume.scope, volume.in_use ? 'em uso' : 'livre', volume.container_count) }
function dockerNetworkMatches(network: DockerNetwork, query: string) { return dockerMatches(query, network.id, network.name, network.driver, network.scope, network.internal ? 'internal' : 'externa', network.in_use ? 'em uso' : 'livre', network.container_count) }
function dockerImageKey(image: DockerImage) { return `${image.id}:${image.repository}:${image.tag}` }
function dockerNetworkKey(network: DockerNetwork) { return network.id || network.name }
function dockerNetworkBuiltIn(network: DockerNetwork) { return ['bridge', 'host', 'none'].includes(network.name) }
function dockerUsageDescription(inUse: boolean, count = 0) { return inUse ? `${count || 1} container${count === 1 ? '' : 's'} associado${count === 1 ? '' : 's'}` : 'Sem containers associados' }
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
