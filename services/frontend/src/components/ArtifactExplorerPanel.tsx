import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import { confirmDialog } from '../lib/appDialog'
import { requestArtifactIndex } from '../lib/artifactIndexing'
import type { ManagedArtifact } from '../types'
import { ArtifactPreview } from './ArtifactPreview'
import { ArtifactViewerModal } from './ArtifactViewerModal'
import { BundleExplorerModal } from './BundleExplorer'
import { Icon } from './Icon'

type SortMode = 'newest' | 'oldest' | 'name-asc' | 'name-desc' | 'size-desc' | 'size-asc'
type ViewMode = 'cards' | 'table'
type DirectionFilter = 'all' | 'input' | 'output'

export function ArtifactExplorerPanel({ sessionId, onError }: { sessionId: string; onError: (message: string) => void }) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<ManagedArtifact[]>([])
  const [selected, setSelected] = useState<ManagedArtifact>()
  const [sortMode, setSortMode] = useState<SortMode>('newest')
  const [direction, setDirection] = useState<DirectionFilter>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('cards')
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)

  async function refresh() {
    setLoading(true)
    try { setItems((await api.managedArtifacts('', false, 'library')).artifacts || []) }
    catch (error) { onError(messageOf(error)) }
    finally { setLoading(false) }
  }

  useEffect(() => { void refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
    const ok = await confirmDialog({ title: 'Eliminar ficheiro?', message: `${item.artifact.name}\n\nO objeto será removido da biblioteca do Wharnex.`, tone: 'danger', confirmLabel: 'Eliminar' })
    if (!ok) return
    try { await api.deleteManagedArtifact(item.session_id, item.artifact.id); if (selected && artifactKey(selected) === artifactKey(item)) setSelected(undefined); await refresh() }
    catch (error) { onError(messageOf(error)) }
  }

  return <section className="right-tool-panel artifact-explorer-panel file-library-panel">
    <header className="right-tool-heading artifact-explorer-heading"><div><span>Biblioteca de ficheiros</span><strong>Todos os artefactos guardados</strong></div><div className="file-library-heading-actions"><button type="button" onClick={() => uploadRef.current?.click()} disabled={uploading} title="Carregar ficheiros"><Icon name="plus" size={14}/></button><button type="button" onClick={() => void refresh()} aria-label="Atualizar biblioteca" title="Atualizar"><Icon name="refresh" size={15}/></button></div></header>
    <input ref={uploadRef} className="sr-only" type="file" multiple aria-label="Carregar ficheiros para a biblioteca" onChange={(event) => void upload(event.target.files)}/>

    <div className="artifact-explorer-toolbar">
      <label className="panel-search-field artifact-explorer-search"><Icon name="search" size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar ficheiros, chats, projetos ou SHA…" aria-label="Pesquisar ficheiros"/></label>
      <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} aria-label="Ordenar ficheiros"><option value="newest">Mais recentes</option><option value="oldest">Mais antigos</option><option value="name-asc">Nome A–Z</option><option value="name-desc">Nome Z–A</option><option value="size-desc">Maior tamanho</option><option value="size-asc">Menor tamanho</option></select>
      <select value={direction} onChange={(event) => setDirection(event.target.value as DirectionFilter)} aria-label="Filtrar direção"><option value="all">Todos</option><option value="input">Recebidos</option><option value="output">Devolvidos</option></select>
      <div className="file-view-switch" role="group" aria-label="Modo de visualização"><button type="button" className={viewMode === 'cards' ? 'active' : ''} onClick={() => setViewMode('cards')} title="Cards"><Icon name="package" size={14}/></button><button type="button" className={viewMode === 'table' ? 'active' : ''} onClick={() => setViewMode('table')} title="Tabela"><Icon name="list" size={14}/></button></div>
    </div>

    <div className="artifact-explorer-summary"><div><strong>{loading ? 'A carregar…' : visibleItems.length}</strong><span>ficheiros visíveis · {items.length} no total</span></div><small>Use Indexar para inserir @lib no próximo prompt.</small></div>

    {viewMode === 'cards' ? <div className="file-library-grid">{visibleItems.map((item) => <ArtifactCard key={artifactKey(item)} item={item} onOpen={() => setSelected(item)} onIndex={() => requestArtifactIndex('lib', `session|${item.session_id}|${item.artifact.id}`)} onDelete={() => void remove(item)}/>)}</div>
      : <div className="file-library-table" role="table"><div className="file-library-table-head" role="row"><span>Nome</span><span>Origem</span><span>Tamanho</span><span>Data</span><span>Ações</span></div>{visibleItems.map((item) => <div className="file-library-table-row" role="row" key={artifactKey(item)}><button type="button" className="file-library-name" onClick={() => setSelected(item)}><Icon name={item.artifact.bundle ? 'package' : 'file'} size={14}/><span><b>{item.artifact.name}</b><small>{item.artifact.content_type || item.artifact.kind}</small></span></button><span>{projectName(item.project_path)}{item.chat_id ? <small>{item.chat_id}</small> : null}</span><span>{formatBytes(item.artifact.size)}</span><span>{formatDate(item.artifact.created_at)}</span><span className="file-library-row-actions"><button type="button" onClick={() => requestArtifactIndex('lib', `session|${item.session_id}|${item.artifact.id}`)}>Indexar</button><button type="button" onClick={() => setSelected(item)}>Abrir</button><button type="button" className="danger" aria-label={`Eliminar ${item.artifact.name}`} onClick={() => void remove(item)}><Icon name="trash" size={12}/></button></span></div>)}</div>}

    {!loading && !visibleItems.length && <div className="artifact-preview-empty"><Icon name="file" size={28}/><strong>Nenhum ficheiro</strong><span>Carregue ficheiros diretamente para a biblioteca ou guarde artefactos de um chat.</span></div>}
    {selected?.artifact.bundle ? <BundleExplorerModal sessionId={selected.session_id} bundle={selected.artifact} onClose={() => setSelected(undefined)}/> : selected ? <ArtifactViewerModal sessionId={selected.session_id} artifactId={selected.artifact.id} items={[{ path: selected.artifact.name, size: selected.artifact.size, content_type: selected.artifact.content_type, kind: undefined }]} initialIndex={0} onClose={() => setSelected(undefined)}/> : null}
  </section>
}

function ArtifactCard({ item, onOpen, onIndex, onDelete }: { item: ManagedArtifact; onOpen: () => void; onIndex: () => void; onDelete: () => void }) {
  const artifact = item.artifact
  return <article className="file-library-card"><button type="button" className="file-library-card-preview" aria-label={`Abrir ${artifact.name}`} onClick={onOpen}><ArtifactPreview path={artifact.name} size={artifact.size} compact url={api.artifactURL(item.session_id, artifact.id, true)}/></button><div className="file-library-card-copy"><strong title={artifact.name}>{artifact.name}</strong><small>{projectName(item.project_path)} · {formatBytes(artifact.size)}</small><span>{artifact.direction === 'input' ? 'Recebido' : 'Devolvido'} · {formatDate(artifact.created_at)}</span></div><div className="file-library-card-actions"><button type="button" onClick={onIndex}><Icon name="link" size={12}/> Indexar</button><a href={api.artifactURL(item.session_id, artifact.id)} download={artifact.name}><Icon name="download" size={12}/></a><button type="button" className="danger" aria-label={`Eliminar ${artifact.name}`} onClick={onDelete}><Icon name="trash" size={12}/></button></div></article>
}

function artifactKey(item: ManagedArtifact) { return `${item.session_id}:${item.artifact.id}` }
function searchableArtifactText(item: ManagedArtifact) { return [item.artifact.name, item.artifact.kind, item.artifact.request_id, item.artifact.sha256, item.project_path, item.chat_id].filter(Boolean).join(' ').toLocaleLowerCase('pt') }
function projectName(path: string) { return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() || path || 'Projeto' }
function compareArtifacts(left: ManagedArtifact, right: ManagedArtifact, mode: SortMode) { const a = left.artifact; const b = right.artifact; if (mode === 'oldest') return Date.parse(a.created_at) - Date.parse(b.created_at); if (mode === 'name-asc') return a.name.localeCompare(b.name, 'pt'); if (mode === 'name-desc') return b.name.localeCompare(a.name, 'pt'); if (mode === 'size-desc') return b.size - a.size; if (mode === 'size-asc') return a.size - b.size; return Date.parse(b.created_at) - Date.parse(a.created_at) }
function formatBytes(size: number) { if (size < 1024) return `${size} B`; if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`; return `${(size / (1024 * 1024)).toFixed(1)} MB` }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('pt-PT', { dateStyle: 'short', timeStyle: 'short' }).format(date) }
function messageOf(error: unknown) { return error instanceof Error ? error.message : String(error) }
async function fileBase64(file: File) { const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''; const chunk = 0x8000; for (let offset = 0; offset < bytes.length; offset += chunk) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk)); return btoa(binary) }
