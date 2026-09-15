import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { confirmDialog } from '../lib/appDialog'
import type { ArtifactEntry, ManagedArtifact } from '../types'
import { ArtifactPreview } from './ArtifactPreview'
import { Icon } from './Icon'

export function ArtifactExplorerPanel({ onError }: { onError: (message: string) => void }) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<ManagedArtifact[]>([])
  const [selected, setSelected] = useState<ManagedArtifact>()
  const [entries, setEntries] = useState<ArtifactEntry[]>([])
  const [selectedPath, setSelectedPath] = useState('')
  const [loading, setLoading] = useState(false)

  async function refresh(search = query) {
    setLoading(true)
    try {
      const result = await api.managedArtifacts(search, true)
      setItems(result.artifacts || [])
      if (selected && !result.artifacts.some((item) => item.session_id === selected.session_id && item.artifact.id === selected.artifact.id)) {
        setSelected(undefined); setEntries([]); setSelectedPath('')
      }
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
  useEffect(() => {
    if (!selected) { setEntries([]); setSelectedPath(''); return }
    let alive = true
    setEntries([]); setSelectedPath('')
    void api.artifactEntries(selected.session_id, selected.artifact.id)
      .then((result) => { if (alive) setEntries(result.entries || []) })
      .catch((error) => { if (alive) onError(messageOf(error)) })
    return () => { alive = false }
  }, [onError, selected])

  const files = useMemo(() => entries.filter((entry) => !entry.dir), [entries])
  const chosen = files.find((entry) => entry.path === selectedPath)

  async function remove(item: ManagedArtifact) {
    const ok = await confirmDialog({ title: 'Eliminar bundle?', message: `${item.artifact.name}\n\nO objeto será removido do MinIO e do catálogo do Wharnex.`, tone: 'danger', confirmLabel: 'Eliminar bundle' })
    if (!ok) return
    try { await api.deleteManagedArtifact(item.session_id, item.artifact.id); await refresh() } catch (error) { onError(messageOf(error)) }
  }

  return <section className="right-tool-panel artifact-explorer-panel">
    <header className="right-tool-heading"><div><span>MinIO · todos os projetos</span><strong>Explorador de artefactos</strong></div><button type="button" onClick={() => void refresh()} aria-label="Atualizar bundles"><Icon name="refresh" size={13}/></button></header>
    <form className="right-tool-search" onSubmit={(event) => { event.preventDefault(); void refresh() }}><Icon name="search" size={13}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome, projeto, request, SHA…"/><button type="submit">Procurar</button></form>
    <div className="artifact-explorer-summary"><span>{loading ? 'A carregar…' : `${items.length} bundle${items.length === 1 ? '' : 's'}`}</span><small>Bundles geridos pelo Wharnex e persistidos no armazenamento de artefactos.</small></div>
    <div className="artifact-explorer-layout">
      <div className="artifact-explorer-list">{items.map((item) => <article key={`${item.session_id}:${item.artifact.id}`} className={sameArtifact(item, selected) ? 'active' : ''}>
        <button type="button" className="artifact-explorer-open" onClick={() => setSelected(item)}><span className={`artifact-direction ${item.artifact.direction}`}>{item.artifact.direction === 'input' ? '↑' : '↓'}</span><span><strong>{item.artifact.name}</strong><small>{projectName(item.project_path)} · {formatBytes(item.artifact.size)} · {formatDate(item.artifact.created_at)}</small><em>{item.artifact.request_id || item.artifact.id}</em></span></button>
        <div className="artifact-explorer-actions"><a href={api.artifactURL(item.session_id, item.artifact.id)} download={item.artifact.name} title="Descarregar bundle"><Icon name="download" size={12}/></a><button type="button" onClick={() => void remove(item)} title="Eliminar bundle"><Icon name="trash" size={12}/></button></div>
      </article>)}{!loading && !items.length && <div className="right-tool-empty"><Icon name="package" size={22}/><strong>Nenhum bundle encontrado</strong><span>Altere a pesquisa ou aguarde novos artefactos persistidos.</span></div>}</div>
      <div className="artifact-explorer-preview">{selected ? <><header><div><strong>{selected.artifact.name}</strong><small>{selected.project_path}</small></div><a href={api.artifactURL(selected.session_id, selected.artifact.id)} download={selected.artifact.name}><Icon name="download" size={12}/> Bundle</a></header><div className="artifact-entry-list">{files.map((entry) => <button type="button" key={entry.path} className={entry.path === selectedPath ? 'active' : ''} onClick={() => setSelectedPath(entry.path)}><Icon name="file" size={11}/><span>{entry.path}</span><small>{formatBytes(entry.size)}</small></button>)}</div><div className="artifact-entry-preview">{chosen ? <ArtifactPreview sessionId={selected.session_id} path={chosen.path} size={chosen.size} url={api.artifactEntryURL(selected.session_id, selected.artifact.id, chosen.path)}/> : <div className="right-tool-empty compact"><span>Selecione um ficheiro do bundle para o pré-visualizar.</span></div>}</div></> : <div className="right-tool-empty"><Icon name="package" size={24}/><strong>Selecione um bundle</strong><span>Explore conteúdo, pré-visualize ficheiros, descarregue ou elimine o artefacto.</span></div>}</div>
    </div>
  </section>
}

function sameArtifact(left: ManagedArtifact, right?: ManagedArtifact) { return Boolean(right && left.session_id === right.session_id && left.artifact.id === right.artifact.id) }
function projectName(path: string) { return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path }
function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`; return `${(value / 1024 ** 2).toFixed(1)} MiB` }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('pt-PT', { dateStyle: 'short', timeStyle: 'short' }).format(date) }
function messageOf(error: unknown) { return error instanceof Error ? error.message : String(error) }
