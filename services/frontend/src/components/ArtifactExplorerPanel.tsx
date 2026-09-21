import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import { confirmDialog } from '../lib/appDialog'
import { requestArtifactIndex } from '../lib/artifactIndexing'
import type { BackendStorageUsage, ManagedArtifact } from '../types'
import { ArtifactPreview } from './ArtifactPreview'
import { ArtifactViewerModal } from './ArtifactViewerModal'
import { BundleExplorerModal } from './BundleExplorer'
import { Icon } from './Icon'

type SortMode = 'newest' | 'oldest' | 'name-asc' | 'name-desc' | 'size-desc' | 'size-asc'
type ViewMode = 'cards' | 'table'
type DirectionFilter = 'all' | 'input' | 'output'
type LibraryMode = 'library' | 'bundles'
type TimeWindow = 'all' | '24h' | '7d' | '30d' | '90d' | 'custom'

export function ArtifactExplorerPanel({ sessionId, onError, onClose }: { sessionId: string; onError: (message: string) => void; onClose?: () => void }) {
  const [mode, setMode] = useState<LibraryMode>('library')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<ManagedArtifact[]>([])
  const [storage, setStorage] = useState<BackendStorageUsage>()
  const [selected, setSelected] = useState<ManagedArtifact>()
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [sortMode, setSortMode] = useState<SortMode>('newest')
  const [direction, setDirection] = useState<DirectionFilter>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('cards')
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)

  async function refresh() {
    setLoading(true)
    try {
      const result = mode === 'library' ? await api.managedArtifacts('', false, 'library') : await api.managedArtifacts('', true)
      const nextItems = result.artifacts || []
      setItems(nextItems)
      const liveKeys = new Set(nextItems.map(artifactKey))
      setSelectedKeys((current) => new Set([...current].filter((key) => liveKeys.has(key))))
      try { setStorage(await api.storage()) } catch { setStorage(undefined) }
    } catch (error) { onError(messageOf(error)) }
    finally { setLoading(false) }
  }

  useEffect(() => { setSelected(undefined); setSelectedKeys(new Set()); void refresh() }, [mode])

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pt')
    return items
      .filter((item) => direction === 'all' || item.artifact.direction === direction)
      .filter((item) => mode !== 'bundles' || matchesTimeWindow(item.artifact.created_at, timeWindow, dateFrom, dateTo))
      .filter((item) => !needle || searchableArtifactText(item).includes(needle))
      .sort((left, right) => compareArtifacts(left, right, sortMode))
  }, [dateFrom, dateTo, direction, items, mode, query, sortMode, timeWindow])

  const allVisibleSelected = visibleItems.length > 0 && visibleItems.every((item) => selectedKeys.has(artifactKey(item)))

  async function upload(files: FileList | null) {
    if (!files?.length || !sessionId) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        await api.persistArtifact(sessionId, {
          request_id: `library_${Date.now()}`,
          direction: 'input', kind: 'library', filename: file.name,
          content_type: file.type || 'application/octet-stream', content_base64: await fileBase64(file),
        })
      }
      await refresh()
    } catch (error) { onError(messageOf(error)) }
    finally { setUploading(false); if (uploadRef.current) uploadRef.current.value = '' }
  }

  function toggleSelection(item: ManagedArtifact) {
    const key = artifactKey(item)
    setSelectedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  function toggleVisibleSelection() {
    setSelectedKeys((current) => {
      const next = new Set(current)
      for (const item of visibleItems) {
        const key = artifactKey(item)
        if (allVisibleSelected) next.delete(key); else next.add(key)
      }
      return next
    })
  }

  async function remove(item: ManagedArtifact) {
    const isBundle = item.artifact.bundle
    const ok = await confirmDialog({ title: isBundle ? 'Eliminar bundle?' : 'Eliminar ficheiro?', message: `${item.artifact.name}\n\nO objeto será removido definitivamente do armazenamento do Wharnex.`, tone: 'danger', confirmLabel: 'Eliminar' })
    if (!ok) return
    try {
      await api.deleteManagedArtifact(item.session_id, item.artifact.id)
      setSelectedKeys((current) => { const next = new Set(current); next.delete(artifactKey(item)); return next })
      if (selected && artifactKey(selected) === artifactKey(item)) setSelected(undefined)
      await refresh()
    } catch (error) { onError(messageOf(error)) }
  }

  async function removeSelected() {
    const targets = items.filter((item) => selectedKeys.has(artifactKey(item)))
    if (!targets.length) return
    const bundles = targets.filter((item) => item.artifact.bundle).length
    const files = targets.length - bundles
    const parts = [bundles ? `${bundles} ${bundles === 1 ? 'bundle' : 'bundles'}` : '', files ? `${files} ${files === 1 ? 'ficheiro' : 'ficheiros'}` : ''].filter(Boolean)
    const ok = await confirmDialog({ title: `Eliminar ${targets.length} itens?`, message: `${parts.join(' e ')} serão removidos definitivamente do armazenamento do Wharnex.`, tone: 'danger', confirmLabel: `Eliminar ${targets.length}` })
    if (!ok) return
    setDeleting(true)
    const failed = new Set<string>()
    try {
      for (const item of targets) {
        try { await api.deleteManagedArtifact(item.session_id, item.artifact.id) }
        catch { failed.add(artifactKey(item)) }
      }
      if (selected && targets.some((item) => artifactKey(item) === artifactKey(selected)) && !failed.has(artifactKey(selected))) setSelected(undefined)
      setSelectedKeys(failed)
      await refresh()
      if (failed.size) onError(`Não foi possível eliminar ${failed.size} ${failed.size === 1 ? 'item selecionado' : 'itens selecionados'}. Os restantes foram removidos.`)
    } finally { setDeleting(false) }
  }

  return <section className="right-tool-panel artifact-explorer-panel file-library-panel">
    <header className="right-tool-heading artifact-explorer-heading"><div><strong>Biblioteca de ficheiros</strong><span>Todos os artefactos guardados</span></div><div className="file-library-heading-actions">{mode === 'library' ? <button type="button" onClick={() => uploadRef.current?.click()} disabled={uploading} title="Carregar ficheiros"><Icon name="plus" size={16}/></button> : null}<button type="button" onClick={() => void refresh()} aria-label="Atualizar biblioteca" title="Atualizar"><Icon name="refresh" size={16}/></button>{onClose ? <button type="button" onClick={onClose} aria-label="Fechar biblioteca" title="Fechar biblioteca"><Icon name="close" size={16}/></button> : null}</div></header>
    <input ref={uploadRef} className="sr-only" type="file" multiple aria-label="Carregar ficheiros para a biblioteca" onChange={(event) => void upload(event.target.files)}/>

    <nav className="file-library-tabs" role="tablist" aria-label="Níveis da biblioteca">
      <button type="button" role="tab" aria-selected={mode === 'library'} className={mode === 'library' ? 'active' : ''} onClick={() => setMode('library')}><Icon name="file" size={13}/><span className="semantic-tab-label">Biblioteca</span></button>
      <button type="button" role="tab" aria-selected={mode === 'bundles'} className={mode === 'bundles' ? 'active' : ''} onClick={() => setMode('bundles')}><Icon name="package" size={13}/><span className="semantic-tab-label">Bundles</span></button>
    </nav>

    <StorageSummary storage={storage}/>

    <div className="artifact-explorer-toolbar">
      <label className="panel-search-field artifact-explorer-search"><Icon name="search" size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={mode === 'library' ? 'Pesquisar ficheiros, projetos ou SHA…' : 'Pesquisar bundles, chats, requests ou SHA…'} aria-label="Pesquisar ficheiros"/></label>
      <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} aria-label="Ordenar ficheiros"><option value="newest">Mais recentes</option><option value="oldest">Mais antigos</option><option value="name-asc">Nome A–Z</option><option value="name-desc">Nome Z–A</option><option value="size-desc">Maior tamanho</option><option value="size-asc">Menor tamanho</option></select>
      <select value={direction} onChange={(event) => setDirection(event.target.value as DirectionFilter)} aria-label="Filtrar direção"><option value="all">Todos</option><option value="input">{mode === 'bundles' ? 'Pedidos' : 'Recebidos'}</option><option value="output">{mode === 'bundles' ? 'Respostas' : 'Devolvidos'}</option></select>
      <div className="file-view-switch" role="group" aria-label="Modo de visualização"><button type="button" className={viewMode === 'cards' ? 'active' : ''} onClick={() => setViewMode('cards')} title="Cards"><Icon name="package" size={16}/></button><button type="button" className={viewMode === 'table' ? 'active' : ''} onClick={() => setViewMode('table')} title="Tabela"><Icon name="list" size={16}/></button></div>
    </div>

    {mode === 'bundles' ? <div className="file-library-date-filters" aria-label="Filtros temporais de bundles">
      <label><span>Janela temporal</span><select value={timeWindow} onChange={(event) => setTimeWindow(event.target.value as TimeWindow)} aria-label="Janela temporal"><option value="all">Todo o período</option><option value="24h">Últimas 24 horas</option><option value="7d">Últimos 7 dias</option><option value="30d">Últimos 30 dias</option><option value="90d">Últimos 90 dias</option><option value="custom">Intervalo personalizado</option></select></label>
      {timeWindow === 'custom' ? <><label><span>De</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="Data inicial"/></label><label><span>Até</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="Data final"/></label></> : null}
      {timeWindow !== 'all' ? <button type="button" className="artifact-filter-reset" onClick={() => { setTimeWindow('all'); setDateFrom(''); setDateTo('') }}>Limpar período</button> : null}
    </div> : null}

    <div className="artifact-explorer-summary"><div><strong>{loading ? 'A carregar…' : visibleItems.length}</strong><span>{mode === 'library' ? 'ficheiros' : 'bundles'} visíveis · {items.length} no total</span></div><div className="artifact-explorer-selection-actions">{visibleItems.length ? <button type="button" onClick={toggleVisibleSelection}>{allVisibleSelected ? 'Limpar visíveis' : 'Selecionar visíveis'}</button> : null}{selectedKeys.size ? <><span className="file-library-selection-count">{selectedKeys.size} selecionado{selectedKeys.size === 1 ? '' : 's'}</span><button type="button" className="danger" disabled={deleting} onClick={() => void removeSelected()}><Icon name="trash" size={12}/>{deleting ? 'A eliminar…' : `Eliminar selecionados (${selectedKeys.size})`}</button></> : <small>{mode === 'library' ? 'Use Indexar para inserir @lib no próximo prompt.' : 'Abra, filtre, selecione ou elimine bundles em lote.'}</small>}</div></div>

    {viewMode === 'cards' ? <div className="file-library-grid">{visibleItems.map((item) => <ArtifactCard key={artifactKey(item)} item={item} canIndex={mode === 'library'} selected={selectedKeys.has(artifactKey(item))} onToggleSelected={() => toggleSelection(item)} onOpen={() => setSelected(item)} onIndex={() => requestArtifactIndex('lib', `session|${item.session_id}|${item.artifact.id}`)} onDelete={() => void remove(item)}/>)}</div>
      : <ArtifactTable items={visibleItems} mode={mode} selectedKeys={selectedKeys} allVisibleSelected={allVisibleSelected} onToggleAll={toggleVisibleSelection} onToggle={toggleSelection} onOpen={setSelected} onDelete={(item) => void remove(item)}/>}

    {!loading && !visibleItems.length && <div className="artifact-preview-empty"><Icon name={mode === 'library' ? 'file' : 'package'} size={28}/><strong>{mode === 'library' ? 'Nenhum ficheiro' : 'Nenhum bundle'}</strong><span>{mode === 'library' ? 'Carregue ficheiros diretamente para a biblioteca ou guarde artefactos de um chat.' : 'Ajuste os filtros ou aguarde por novos bundles trocados com os providers.'}</span></div>}
    {selected?.artifact.bundle ? <BundleExplorerModal sessionId={selected.session_id} bundle={selected.artifact} onClose={() => setSelected(undefined)}/> : selected ? <ArtifactViewerModal sessionId={selected.session_id} artifactId={selected.artifact.id} items={[{ path: selected.artifact.name, size: selected.artifact.size, content_type: selected.artifact.content_type, kind: undefined }]} initialIndex={0} onClose={() => setSelected(undefined)}/> : null}
  </section>
}

function ArtifactTable({ items, mode, selectedKeys, allVisibleSelected, onToggleAll, onToggle, onOpen, onDelete }: { items: ManagedArtifact[]; mode: LibraryMode; selectedKeys: Set<string>; allVisibleSelected: boolean; onToggleAll: () => void; onToggle: (item: ManagedArtifact) => void; onOpen: (item: ManagedArtifact) => void; onDelete: (item: ManagedArtifact) => void }) {
  return <div className="file-library-table" role="table"><div className="file-library-table-head" role="row"><label className="artifact-explorer-check" title="Selecionar itens visíveis"><input type="checkbox" checked={allVisibleSelected} onChange={onToggleAll} aria-label="Selecionar itens visíveis"/><span/></label><span>Nome</span><span>Origem</span><span>Tamanho</span><span>Data</span><span>Ações</span></div>{items.map((item) => <div className={`file-library-table-row ${selectedKeys.has(artifactKey(item)) ? 'selected' : ''}`} role="row" key={artifactKey(item)}><label className="artifact-explorer-check" title={`Selecionar ${item.artifact.name}`}><input type="checkbox" checked={selectedKeys.has(artifactKey(item))} onChange={() => onToggle(item)} aria-label={`Selecionar ${item.artifact.name}`}/><span/></label><button type="button" className="file-library-name" onClick={() => onOpen(item)}><Icon name={item.artifact.bundle ? 'package' : 'file'} size={14}/><span><b>{item.artifact.name}</b><small>{item.artifact.content_type || item.artifact.kind}</small></span></button><span>{projectName(item.project_path)}{item.chat_id ? <small>{item.chat_id}</small> : null}</span><span>{formatBytes(item.artifact.size)}</span><span>{formatDate(item.artifact.created_at)}</span><span className="file-library-row-actions">{mode === 'library' ? <button type="button" onClick={() => requestArtifactIndex('lib', `session|${item.session_id}|${item.artifact.id}`)}>Indexar</button> : null}<button type="button" onClick={() => onOpen(item)}>Abrir</button><a href={api.artifactURL(item.session_id, item.artifact.id)} download={item.artifact.name} aria-label={`Descarregar ${item.artifact.name}`}><Icon name="download" size={12}/></a><button type="button" className="danger" aria-label={`Eliminar ${item.artifact.name}`} onClick={() => onDelete(item)}><Icon name="trash" size={12}/></button></span></div>)}</div>
}

function StorageSummary({ storage }: { storage?: BackendStorageUsage }) {
  const values = storage ? [
    ['Total', storage.total_bytes], ['Artefactos', storage.artifact_bytes], ['Arquivo', storage.archive_bytes], ['Contexto', storage.context_bytes],
  ] as const : []
  return <section className="file-library-storage" aria-label="Resumo de ocupação em disco"><div><span>Ocupação em disco</span><strong>{storage ? formatBytes(storage.total_bytes) : 'A calcular…'}</strong></div><div>{values.map(([label, value]) => <span key={label}><small>{label}</small><b>{formatBytes(value)}</b></span>)}</div></section>
}

function ArtifactCard({ item, canIndex, selected, onToggleSelected, onOpen, onIndex, onDelete }: { item: ManagedArtifact; canIndex: boolean; selected: boolean; onToggleSelected: () => void; onOpen: () => void; onIndex: () => void; onDelete: () => void }) {
  const artifact = item.artifact
  const directionLabel = artifact.bundle ? (artifact.direction === 'input' ? 'Pedido' : 'Resposta') : artifact.direction === 'input' ? 'Recebido' : 'Devolvido'
  return <article className={`file-library-card ${artifact.bundle ? 'bundle-card' : ''} ${selected ? 'selected' : ''}`}>
    <label className="artifact-explorer-check file-library-card-check" title={`Selecionar ${artifact.name}`}><input type="checkbox" checked={selected} onChange={onToggleSelected} aria-label={`Selecionar ${artifact.name}`}/><span/></label>
    <button type="button" className="file-library-card-preview" aria-label={`Abrir ${artifact.name}`} onClick={onOpen}>
      {artifact.bundle ? <BundleCardPreview item={item}/> : <ArtifactPreview path={artifact.name} size={artifact.size} compact url={api.artifactURL(item.session_id, artifact.id, true)}/>}
      <span className="file-library-card-type">{artifact.bundle ? 'BUNDLE' : artifactTypeLabel(artifact.name, artifact.content_type)}</span>
      <span className={`file-library-card-direction ${artifact.direction}`}>{directionLabel}</span>
    </button>
    <div className="file-library-card-copy">
      <div className="file-library-card-title"><span><Icon name={artifact.bundle ? 'package' : 'file'} size={13}/></span><strong title={artifact.name}>{artifact.name}</strong></div>
      <small title={item.project_path}>{projectName(item.project_path)}{item.chat_id ? ` · ${shortIdentifier(item.chat_id)}` : ''}</small>
      <span>{formatBytes(artifact.size)} · {formatDate(artifact.created_at)}</span>
    </div>
    <div className="file-library-card-actions">
      <div>{canIndex ? <button type="button" className="file-library-card-primary" onClick={onIndex}><Icon name="link" size={12}/> Indexar</button> : null}<button type="button" onClick={onOpen}><Icon name="external" size={12}/> Abrir</button></div>
      <div><a href={api.artifactURL(item.session_id, artifact.id)} download={artifact.name} aria-label={`Descarregar ${artifact.name}`} title="Descarregar"><Icon name="download" size={12}/></a><button type="button" className="danger" aria-label={`Eliminar ${artifact.name}`} title="Eliminar" onClick={onDelete}><Icon name="trash" size={12}/></button></div>
    </div>
  </article>
}

function BundleCardPreview({ item }: { item: ManagedArtifact }) {
  const artifact = item.artifact
  return <div className={`file-library-bundle-visual ${artifact.direction}`}><span className="file-library-bundle-icon"><Icon name="package" size={30}/></span><div><strong>{artifact.direction === 'input' ? 'Bundle de pedido' : 'Bundle de resposta'}</strong><small>{artifact.request_id ? shortIdentifier(artifact.request_id, 28) : 'Sem request associado'}</small><span>{artifact.entry_count !== undefined ? `${artifact.entry_count} itens · ` : ''}SHA {artifact.sha256.slice(0, 10)}…</span></div></div>
}

function artifactTypeLabel(name: string, contentType = '') {
  const extension = name.split('.').pop()?.trim().toUpperCase()
  if (extension && extension !== name.toUpperCase() && extension.length <= 6) return extension
  if (contentType.startsWith('image/')) return 'IMG'
  if (contentType.startsWith('video/')) return 'VÍDEO'
  if (contentType.startsWith('audio/')) return 'ÁUDIO'
  return 'FICHEIRO'
}

function matchesTimeWindow(createdAt: string, window: TimeWindow, from: string, to: string) {
  if (window === 'all') return true
  const created = new Date(createdAt).getTime()
  if (!Number.isFinite(created)) return false
  if (window === 'custom') {
    const start = from ? new Date(`${from}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY
    const end = to ? new Date(`${to}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY
    return created >= start && created <= end
  }
  const durations: Record<Exclude<TimeWindow, 'all' | 'custom'>, number> = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30, '90d': 24 * 90 }
  return created >= Date.now() - durations[window] * 60 * 60 * 1000
}

function artifactKey(item: ManagedArtifact) { return `${item.session_id}:${item.artifact.id}` }
function searchableArtifactText(item: ManagedArtifact) { return [item.artifact.name, item.artifact.kind, item.artifact.request_id, item.artifact.sha256, item.project_path, item.chat_id].filter(Boolean).join(' ').toLocaleLowerCase('pt') }
function projectName(path: string) { return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() || path || 'Projeto' }
function shortIdentifier(value: string, length = 18) { return value.length > length ? `${value.slice(0, length - 1)}…` : value }
function compareArtifacts(left: ManagedArtifact, right: ManagedArtifact, mode: SortMode) { const a = left.artifact; const b = right.artifact; if (mode === 'oldest') return Date.parse(a.created_at) - Date.parse(b.created_at); if (mode === 'name-asc') return a.name.localeCompare(b.name, 'pt'); if (mode === 'name-desc') return b.name.localeCompare(a.name, 'pt'); if (mode === 'size-desc') return b.size - a.size; if (mode === 'size-asc') return a.size - b.size; return Date.parse(b.created_at) - Date.parse(a.created_at) }
function formatBytes(value: number) { if (!Number.isFinite(value) || value <= 0) return '0 B'; const units = ['B', 'KB', 'MB', 'GB', 'TB']; const rank = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024))); const amount = value / (1024 ** rank); const displayed = rank === 0 || Number.isInteger(amount) || amount >= 10 ? Math.round(amount) : amount.toFixed(1); return `${displayed} ${units[rank]}` }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString() }
function messageOf(error: unknown) { return error instanceof Error ? error.message : String(error) }
async function fileBase64(file: File) { const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''; const chunk = 0x8000; for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk)); return btoa(binary) }
