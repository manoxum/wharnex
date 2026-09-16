import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { confirmDialog } from '../lib/appDialog'
import type { ManagedArtifact } from '../types'
import { BundleExplorerModal } from './BundleExplorer'
import { Icon } from './Icon'

type SortMode = 'newest' | 'oldest' | 'name-asc' | 'name-desc' | 'size-desc' | 'size-asc'
type DirectionFilter = 'all' | 'input' | 'output'
type DateWindow = 'all' | '24h' | '7d' | '30d' | '90d' | 'custom'

export function ArtifactExplorerPanel({ onError }: { onError: (message: string) => void }) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<ManagedArtifact[]>([])
  const [selectedBundle, setSelectedBundle] = useState<ManagedArtifact>()
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [sortMode, setSortMode] = useState<SortMode>('newest')
  const [direction, setDirection] = useState<DirectionFilter>('all')
  const [projectPath, setProjectPath] = useState('all')
  const [dateWindow, setDateWindow] = useState<DateWindow>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function refresh() {
    setLoading(true)
    try {
      const result = await api.managedArtifacts('', true)
      const next = result.artifacts || []
      setItems(next)
      setSelectedKeys((current) => new Set([...current].filter((key) => next.some((item) => artifactKey(item) === key))))
      if (selectedBundle && !next.some((item) => artifactKey(item) === artifactKey(selectedBundle))) setSelectedBundle(undefined)
    } catch (error) { onError(messageOf(error)) } finally { setLoading(false) }
  }

  useEffect(() => {
    let alive = true
    setLoading(true)
    void api.managedArtifacts('', true)
      .then((result) => { if (alive) setItems(result.artifacts || []) })
      .catch((error) => { if (alive) onError(messageOf(error)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [onError])

  const projects = useMemo(() => {
    const unique = new Map<string, string>()
    items.forEach((item) => unique.set(item.project_path, projectName(item.project_path)))
    return [...unique.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt'))
  }, [items])

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('pt')
    return items
      .filter((item) => direction === 'all' || item.artifact.direction === direction)
      .filter((item) => projectPath === 'all' || item.project_path === projectPath)
      .filter((item) => matchesDateWindow(item, dateWindow, dateFrom, dateTo))
      .filter((item) => !normalizedQuery || searchableArtifactText(item).includes(normalizedQuery))
      .sort((left, right) => compareArtifacts(left, right, sortMode))
  }, [dateFrom, dateTo, dateWindow, direction, items, projectPath, query, sortMode])

  const selectedItems = useMemo(() => items.filter((item) => selectedKeys.has(artifactKey(item))), [items, selectedKeys])
  const visibleSelected = visibleItems.filter((item) => selectedKeys.has(artifactKey(item))).length
  const hasFilters = Boolean(query || direction !== 'all' || projectPath !== 'all' || dateWindow !== 'all' || sortMode !== 'newest')

  function toggleSelection(item: ManagedArtifact) {
    const key = artifactKey(item)
    setSelectedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  function toggleVisibleSelection() {
    const allVisibleSelected = visibleItems.length > 0 && visibleSelected === visibleItems.length
    setSelectedKeys((current) => {
      const next = new Set(current)
      visibleItems.forEach((item) => { if (allVisibleSelected) next.delete(artifactKey(item)); else next.add(artifactKey(item)) })
      return next
    })
  }

  function resetFilters() {
    setQuery(''); setSortMode('newest'); setDirection('all'); setProjectPath('all'); setDateWindow('all'); setDateFrom(''); setDateTo('')
  }

  async function removeOne(item: ManagedArtifact) {
    const ok = await confirmDialog({ title: 'Eliminar bundle?', message: `${item.artifact.name}\n\nO objeto será removido do MinIO e do catálogo do Wharnex.`, tone: 'danger', confirmLabel: 'Eliminar bundle' })
    if (!ok) return
    setDeleting(true)
    try {
      await api.deleteManagedArtifact(item.session_id, item.artifact.id)
      setSelectedKeys((current) => { const next = new Set(current); next.delete(artifactKey(item)); return next })
      await refresh()
    } catch (error) { onError(messageOf(error)) } finally { setDeleting(false) }
  }

  async function removeSelected() {
    if (!selectedItems.length) return
    const count = selectedItems.length
    const ok = await confirmDialog({ title: `Eliminar ${count} bundles?`, message: 'A remoção em massa apaga os objetos do MinIO e as respetivas entradas do catálogo. Esta ação não pode ser desfeita.', tone: 'danger', confirmLabel: `Eliminar ${count}` })
    if (!ok) return
    setDeleting(true)
    const failed = new Set<string>()
    try {
      for (let offset = 0; offset < selectedItems.length; offset += 4) {
        const batch = selectedItems.slice(offset, offset + 4)
        const results = await Promise.allSettled(batch.map((item) => api.deleteManagedArtifact(item.session_id, item.artifact.id)))
        results.forEach((result, index) => { if (result.status === 'rejected') failed.add(artifactKey(batch[index])) })
      }
      setSelectedKeys(failed)
      await refresh()
      if (failed.size) onError(`${failed.size} bundle${failed.size === 1 ? '' : 's'} não puderam ser eliminados. Os restantes foram removidos.`)
    } finally { setDeleting(false) }
  }

  return <section className="right-tool-panel artifact-explorer-panel">
    <header className="right-tool-heading artifact-explorer-heading"><div><span>Biblioteca global · MinIO</span><strong>Explorador de artefactos</strong></div><button type="button" onClick={() => void refresh()} aria-label="Atualizar bundles" title="Atualizar"><Icon name="refresh" size={15}/></button></header>

    <div className="artifact-explorer-toolbar">
      <label className="artifact-explorer-search"><Icon name="search" size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar por nome, projeto, request ou SHA…" aria-label="Pesquisar artefactos"/></label>
      <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} aria-label="Ordenar artefactos">
        <option value="newest">Mais recentes</option><option value="oldest">Mais antigos</option><option value="name-asc">Nome A–Z</option><option value="name-desc">Nome Z–A</option><option value="size-desc">Maior tamanho</option><option value="size-asc">Menor tamanho</option>
      </select>
      <button type="button" className={filtersOpen || hasFilters ? 'active' : ''} onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen}><Icon name="list" size={14}/> Filtros{hasFilters ? <span className="artifact-filter-dot"/> : null}</button>
    </div>

    {filtersOpen && <div className="artifact-explorer-filters">
      <label><span>Projeto</span><select value={projectPath} onChange={(event) => setProjectPath(event.target.value)}><option value="all">Todos os projetos</option>{projects.map(([path, label]) => <option key={path} value={path}>{label}</option>)}</select></label>
      <label><span>Direção</span><select value={direction} onChange={(event) => setDirection(event.target.value as DirectionFilter)}><option value="all">Todas</option><option value="input">Pedidos</option><option value="output">Respostas</option></select></label>
      <label><span>Período</span><select value={dateWindow} onChange={(event) => setDateWindow(event.target.value as DateWindow)}><option value="all">Qualquer data</option><option value="24h">Últimas 24 horas</option><option value="7d">Últimos 7 dias</option><option value="30d">Últimos 30 dias</option><option value="90d">Últimos 90 dias</option><option value="custom">Intervalo específico</option></select></label>
      {dateWindow === 'custom' && <><label><span>De</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="Data inicial"/></label><label><span>Até</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="Data final"/></label></>}
      <button type="button" className="artifact-filter-reset" onClick={resetFilters} disabled={!hasFilters}>Limpar filtros</button>
    </div>}

    <div className="artifact-explorer-summary">
      <div><strong>{loading ? 'A carregar…' : `${visibleItems.length} de ${items.length}`}</strong><span>bundles visíveis</span></div>
      <div className="artifact-explorer-selection-actions"><button type="button" onClick={toggleVisibleSelection} disabled={!visibleItems.length}>{visibleItems.length > 0 && visibleSelected === visibleItems.length ? 'Desmarcar visíveis' : 'Selecionar visíveis'}</button>{selectedItems.length > 0 && <button type="button" className="danger" onClick={() => void removeSelected()} disabled={deleting}><Icon name="trash" size={13}/> Eliminar {selectedItems.length}</button>}</div>
    </div>

    <div className="artifact-explorer-list">{visibleItems.map((item) => {
      const key = artifactKey(item); const checked = selectedKeys.has(key)
      return <article key={key} className={checked ? 'selected' : ''}>
        <label className="artifact-explorer-check" title="Selecionar bundle"><input type="checkbox" checked={checked} onChange={() => toggleSelection(item)} aria-label={`Selecionar ${item.artifact.name}`}/><span/></label>
        <button type="button" className="artifact-explorer-open" onClick={() => setSelectedBundle(item)} aria-label={`Explorar ${item.artifact.name}`}>
          <span className={`artifact-direction ${item.artifact.direction}`}>{item.artifact.direction === 'input' ? '↑' : '↓'}</span>
          <span><strong>{item.artifact.name}</strong><small>{projectName(item.project_path)} · {formatBytes(item.artifact.size)} · {formatDate(item.artifact.created_at)}</small><em>{item.artifact.request_id || item.artifact.id}</em></span>
        </button>
        <div className="artifact-explorer-actions"><a href={api.artifactURL(item.session_id, item.artifact.id)} download={item.artifact.name} title="Descarregar bundle" aria-label={`Descarregar ${item.artifact.name}`}><Icon name="download" size={14}/></a><button type="button" onClick={() => void removeOne(item)} title="Eliminar bundle" aria-label={`Eliminar ${item.artifact.name}`} disabled={deleting}><Icon name="trash" size={14}/></button></div>
      </article>
    })}{!loading && !visibleItems.length && <div className="right-tool-empty artifact-explorer-empty"><Icon name="package" size={28}/><strong>Nenhum bundle encontrado</strong><span>{hasFilters ? 'Ajuste ou limpe os filtros para ampliar os resultados.' : 'Os bundles persistidos pelo Wharnex aparecerão aqui.'}</span>{hasFilters && <button type="button" onClick={resetFilters}>Limpar filtros</button>}</div>}</div>

    {selectedBundle && <BundleExplorerModal sessionId={selectedBundle.session_id} bundle={selectedBundle.artifact} onClose={() => setSelectedBundle(undefined)}/>}
  </section>
}

function artifactKey(item: ManagedArtifact) { return `${item.session_id}:${item.artifact.id}` }
function projectName(path: string) { return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path }
function searchableArtifactText(item: ManagedArtifact) { return [item.artifact.name, item.project_path, item.artifact.request_id, item.artifact.sha256, item.artifact.id, item.session_id, item.chat_id, item.artifact.direction, item.artifact.kind].filter(Boolean).join(' ').toLocaleLowerCase('pt') }
function compareArtifacts(left: ManagedArtifact, right: ManagedArtifact, sort: SortMode) { if (sort === 'name-asc') return left.artifact.name.localeCompare(right.artifact.name, 'pt'); if (sort === 'name-desc') return right.artifact.name.localeCompare(left.artifact.name, 'pt'); if (sort === 'size-desc') return right.artifact.size - left.artifact.size; if (sort === 'size-asc') return left.artifact.size - right.artifact.size; const delta = new Date(left.artifact.created_at).getTime() - new Date(right.artifact.created_at).getTime(); return sort === 'oldest' ? delta : -delta }
function matchesDateWindow(item: ManagedArtifact, window: DateWindow, from: string, to: string) { const created = new Date(item.artifact.created_at).getTime(); if (!Number.isFinite(created)) return window === 'all'; if (window === 'all') return true; if (window !== 'custom') { const hours = window === '24h' ? 24 : window === '7d' ? 24 * 7 : window === '30d' ? 24 * 30 : 24 * 90; return created >= Date.now() - hours * 60 * 60 * 1000 } const start = from ? new Date(`${from}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY; const end = to ? new Date(`${to}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY; return created >= start && created <= end }
function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`; return `${(value / 1024 ** 2).toFixed(1)} MiB` }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('pt-PT', { dateStyle: 'short', timeStyle: 'short' }).format(date) }
function messageOf(error: unknown) { return error instanceof Error ? error.message : String(error) }
