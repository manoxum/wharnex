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

export function ArtifactExplorerPanel({ sessionId, onError, onClose }: { sessionId: string; onError: (message: string) => void; onClose?: () => void }) {
  const [mode, setMode] = useState<LibraryMode>('library')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<ManagedArtifact[]>([])
  const [storage, setStorage] = useState<BackendStorageUsage>()
  const [selected, setSelected] = useState<ManagedArtifact>()
  const [sortMode, setSortMode] = useState<SortMode>('newest')
  const [direction, setDirection] = useState<DirectionFilter>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('cards')
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)

  async function refresh() {
    setLoading(true)
    try {
      const result = mode === 'library' ? await api.managedArtifacts('', false, 'library') : await api.managedArtifacts('', true)
      setItems(result.artifacts || [])
      try { setStorage(await api.storage()) } catch { setStorage(undefined) }
    } catch (error) { onError(messageOf(error)) }
    finally { setLoading(false) }
  }

  useEffect(() => { setSelected(undefined); void refresh() }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pt')
    return items
      .filter((item) => direction === 'all' || item.artifact.direction === direction)
      .filter((item) => !needle || searchableArtifactText(item).includes(needle))
      .sort((left, right) => compareArtifacts(left, right, sortMode))
  }, [direction, items, query, sortMode])

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

  async function remove(item: ManagedArtifact) {
    const isBundle = item.artifact.bundle
    const ok = await confirmDialog({ title: isBundle ? 'Eliminar bundle?' : 'Eliminar ficheiro?', message: `${item.artifact.name}\n\nO objeto será removido definitivamente do armazenamento do Wharnex.`, tone: 'danger', confirmLabel: 'Eliminar' })
    if (!ok) return
    try { await api.deleteManagedArtifact(item.session_id, item.artifact.id); if (selected && artifactKey(selected) === artifactKey(item)) setSelected(undefined); await refresh() }
    catch (error) { onError(messageOf(error)) }
  }

  return <section className="right-tool-panel artifact-explorer-panel file-library-panel">
    <header className="right-tool-heading artifact-explorer-heading"><div><span>Biblioteca de ficheiros</span><strong>Todos os artefactos guardados</strong></div><div className="file-library-heading-actions">{mode === 'library' ? <button type="button" onClick={() => uploadRef.current?.click()} disabled={uploading} title="Carregar ficheiros"><Icon name="plus" size={14}/></button> : null}<button type="button" onClick={() => void refresh()} aria-label="Atualizar biblioteca" title="Atualizar"><Icon name="refresh" size={15}/></button>{onClose ? <button type="button" onClick={onClose} aria-label="Fechar biblioteca" title="Fechar biblioteca"><Icon name="close" size={13}/></button> : null}</div></header>
    <input ref={uploadRef} className="sr-only" type="file" multiple aria-label="Carregar ficheiros para a biblioteca" onChange={(event) => void upload(event.target.files)}/>

    <nav className="file-library-tabs" role="tablist" aria-label="Níveis da biblioteca">
      <button type="button" role="tab" aria-selected={mode === 'library'} className={mode === 'library' ? 'active' : ''} onClick={() => setMode('library')}><Icon name="file" size={13}/><span>Biblioteca</span></button>
      <button type="button" role="tab" aria-selected={mode === 'bundles'} className={mode === 'bundles' ? 'active' : ''} onClick={() => setMode('bundles')}><Icon name="package" size={13}/><span>Bundles</span></button>
    </nav>

    <StorageSummary storage={storage}/>

    <div className="artifact-explorer-toolbar">
      <label className="panel-search-field artifact-explorer-search"><Icon name="search" size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={mode === 'library' ? 'Pesquisar ficheiros, projetos ou SHA…' : 'Pesquisar bundles, chats, requests ou SHA…'} aria-label="Pesquisar ficheiros"/></label>
      <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} aria-label="Ordenar ficheiros"><option value="newest">Mais recentes</option><option value="oldest">Mais antigos</option><option value="name-asc">Nome A–Z</option><option value="name-desc">Nome Z–A</option><option value="size-desc">Maior tamanho</option><option value="size-asc">Menor tamanho</option></select>
      <select value={direction} onChange={(event) => setDirection(event.target.value as DirectionFilter)} aria-label="Filtrar direção"><option value="all">Todos</option><option value="input">Recebidos</option><option value="output">Devolvidos</option></select>
      <div className="file-view-switch" role="group" aria-label="Modo de visualização"><button type="button" className={viewMode === 'cards' ? 'active' : ''} onClick={() => setViewMode('cards')} title="Cards"><Icon name="package" size={14}/></button><button type="button" className={viewMode === 'table' ? 'active' : ''} onClick={() => setViewMode('table')} title="Tabela"><Icon name="list" size={14}/></button></div>
    </div>

    <div className="artifact-explorer-summary"><div><strong>{loading ? 'A carregar…' : visibleItems.length}</strong><span>{mode === 'library' ? 'ficheiros' : 'bundles'} visíveis · {items.length} no total</span></div><small>{mode === 'library' ? 'Use Indexar para inserir @lib no próximo prompt.' : 'Bundles de entrada e resposta podem ser abertos, descarregados ou eliminados.'}</small></div>

    {viewMode === 'cards' ? <div className="file-library-grid">{visibleItems.map((item) => <ArtifactCard key={artifactKey(item)} item={item} canIndex={mode === 'library'} onOpen={() => setSelected(item)} onIndex={() => requestArtifactIndex('lib', `session|${item.session_id}|${item.artifact.id}`)} onDelete={() => void remove(item)}/>)}</div>
      : <div className="file-library-table" role="table"><div className="file-library-table-head" role="row"><span>Nome</span><span>Origem</span><span>Tamanho</span><span>Data</span><span>Ações</span></div>{visibleItems.map((item) => <div className="file-library-table-row" role="row" key={artifactKey(item)}><button type="button" className="file-library-name" onClick={() => setSelected(item)}><Icon name={item.artifact.bundle ? 'package' : 'file'} size={14}/><span><b>{item.artifact.name}</b><small>{item.artifact.content_type || item.artifact.kind}</small></span></button><span>{projectName(item.project_path)}{item.chat_id ? <small>{item.chat_id}</small> : null}</span><span>{formatBytes(item.artifact.size)}</span><span>{formatDate(item.artifact.created_at)}</span><span className="file-library-row-actions">{mode === 'library' ? <button type="button" onClick={() => requestArtifactIndex('lib', `session|${item.session_id}|${item.artifact.id}`)}>Indexar</button> : null}<button type="button" onClick={() => setSelected(item)}>Abrir</button><a href={api.artifactURL(item.session_id, item.artifact.id)} download={item.artifact.name} aria-label={`Descarregar ${item.artifact.name}`}><Icon name="download" size={12}/></a><button type="button" className="danger" aria-label={`Eliminar ${item.artifact.name}`} onClick={() => void remove(item)}><Icon name="trash" size={12}/></button></span></div>)}</div>}

    {!loading && !visibleItems.length && <div className="artifact-preview-empty"><Icon name={mode === 'library' ? 'file' : 'package'} size={28}/><strong>{mode === 'library' ? 'Nenhum ficheiro' : 'Nenhum bundle'}</strong><span>{mode === 'library' ? 'Carregue ficheiros diretamente para a biblioteca ou guarde artefactos de um chat.' : 'Os bundles trocados com os providers aparecem aqui automaticamente.'}</span></div>}
    {selected?.artifact.bundle ? <BundleExplorerModal sessionId={selected.session_id} bundle={selected.artifact} onClose={() => setSelected(undefined)}/> : selected ? <ArtifactViewerModal sessionId={selected.session_id} artifactId={selected.artifact.id} items={[{ path: selected.artifact.name, size: selected.artifact.size, content_type: selected.artifact.content_type, kind: undefined }]} initialIndex={0} onClose={() => setSelected(undefined)}/> : null}
  </section>
}

function StorageSummary({ storage }: { storage?: BackendStorageUsage }) {
  const values = storage ? [
    ['Total', storage.total_bytes], ['Artefactos', storage.artifact_bytes], ['Arquivo', storage.archive_bytes], ['Contexto', storage.context_bytes],
  ] as const : []
  return <section className="file-library-storage" aria-label="Resumo de ocupação em disco"><div><span>Ocupação em disco</span><strong>{storage ? formatBytes(storage.total_bytes) : 'A calcular…'}</strong></div><div>{values.map(([label, value]) => <span key={label}><small>{label}</small><b>{formatBytes(value)}</b></span>)}</div></section>
}

function ArtifactCard({ item, canIndex, onOpen, onIndex, onDelete }: { item: ManagedArtifact; canIndex: boolean; onOpen: () => void; onIndex: () => void; onDelete: () => void }) {
  const artifact = item.artifact
  return <article className="file-library-card"><button type="button" className="file-library-card-preview" aria-label={`Abrir ${artifact.name}`} onClick={onOpen}><ArtifactPreview path={artifact.name} size={artifact.size} compact url={api.artifactURL(item.session_id, artifact.id, true)}/></button><div className="file-library-card-copy"><strong title={artifact.name}>{artifact.name}</strong><small>{projectName(item.project_path)} · {formatBytes(artifact.size)}</small><span>{artifact.direction === 'input' ? 'Recebido' : 'Devolvido'} · {formatDate(artifact.created_at)}</span></div><div className="file-library-card-actions">{canIndex ? <button type="button" onClick={onIndex}><Icon name="link" size={12}/> Indexar</button> : null}<button type="button" onClick={onOpen}><Icon name="external" size={12}/> Abrir</button><a href={api.artifactURL(item.session_id, artifact.id)} download={artifact.name} aria-label={`Descarregar ${artifact.name}`}><Icon name="download" size={12}/></a><button type="button" className="danger" aria-label={`Eliminar ${artifact.name}`} onClick={onDelete}><Icon name="trash" size={12}/></button></div></article>
}

function artifactKey(item: ManagedArtifact) { return `${item.session_id}:${item.artifact.id}` }
function searchableArtifactText(item: ManagedArtifact) { return [item.artifact.name, item.artifact.kind, item.artifact.request_id, item.artifact.sha256, item.project_path, item.chat_id].filter(Boolean).join(' ').toLocaleLowerCase('pt') }
function projectName(path: string) { return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() || path || 'Projeto' }
function compareArtifacts(left: ManagedArtifact, right: ManagedArtifact, mode: SortMode) { const a = left.artifact; const b = right.artifact; if (mode === 'oldest') return Date.parse(a.created_at) - Date.parse(b.created_at); if (mode === 'name-asc') return a.name.localeCompare(b.name, 'pt'); if (mode === 'name-desc') return b.name.localeCompare(a.name, 'pt'); if (mode === 'size-desc') return b.size - a.size; if (mode === 'size-asc') return a.size - b.size; return Date.parse(b.created_at) - Date.parse(a.created_at) }
function formatBytes(value: number) { if (!Number.isFinite(value) || value <= 0) return '0 B'; const units = ['B', 'KB', 'MB', 'GB', 'TB']; const rank = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024))); const amount = value / (1024 ** rank); const displayed = rank === 0 || Number.isInteger(amount) || amount >= 10 ? Math.round(amount) : amount.toFixed(1); return `${displayed} ${units[rank]}` }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString() }
function messageOf(error: unknown) { return error instanceof Error ? error.message : String(error) }
async function fileBase64(file: File) { const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''; const chunk = 0x8000; for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk)); return btoa(binary) }
