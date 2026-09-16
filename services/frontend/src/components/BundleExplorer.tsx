import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ArtifactEntry, ArtifactPresentationGallery, ArtifactRecord, ChatFileRecord, Session } from '../types'
import { api } from '../lib/api'
import { formatBytes } from '../lib/desktop'
import { parseBundleName, parseBundleNameWithDuplicateSuffix } from '../lib/bundlename'
import { Icon } from './Icon'
import { requestArtifactIndex } from '../lib/artifactIndexing'
import { ArtifactPreview } from './ArtifactPreview'
import { ArtifactViewerModal, type ArtifactViewerItem } from './ArtifactViewerModal'

type RequestLineages = NonNullable<Session['request_lineages']>
type BundleTone = 'request-main' | 'request-repair' | 'request-restore' | 'request-summary' | 'response' | 'final-summary'
type BundlePresentation = { tone: BundleTone; label: string }
const EMPTY_ARTIFACTS: ArtifactRecord[] = []

export function BundleExchangeBar({ sessionId, artifacts = [], requestLineages = {} }: { sessionId: string; artifacts?: ArtifactRecord[]; requestLineages?: RequestLineages }) {
  const bundles = useMemo(() => artifacts.filter(isTransportBundleArtifact).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()), [artifacts])
  const [selected, setSelected] = useState<ArtifactRecord>()
  if (!bundles.length) return null
  return <><section className="bundle-exchange-bar" aria-label="Galeria de bundles trocados com o ChatGPT">
    <div className="bundle-exchange-list">{bundles.slice(0, 3).map((bundle) => {
      const presentation = bundlePresentation(bundle, requestLineages)
      return <button key={bundle.id} className={`bundle-card bundle-tone-${presentation.tone}`} type="button" onClick={() => setSelected(bundle)} title={`Explorar ${bundle.name}`}>
        <span className="bundle-kind-mark">{bundle.direction === 'input' ? '↑' : '↓'}</span>
        <span><em>{presentation.label}</em><b>{bundle.name}</b><small>{formatBytes(bundle.size)} · {bundle.entry_count || 0} itens</small></span>
        <Icon name="chevron" size={10}/>
      </button>
    })}</div>
  </section>{selected && <BundleExplorer sessionId={sessionId} bundle={selected} bundles={bundles} requestLineages={requestLineages} onBundle={setSelected} onClose={() => setSelected(undefined)}/>}</>
}

export function ReturnedArtifactGallery({ sessionId, artifacts = [], requestId }: { sessionId: string; artifacts?: ArtifactRecord[]; requestId: string }) {
  const bundle = useMemo(() => artifacts.filter((item) => isTransportBundleArtifact(item) && item.direction === 'output' && item.request_id === requestId).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0], [artifacts, requestId])
  const [galleries, setGalleries] = useState<ArtifactPresentationGallery[]>([])
  const [warning, setWarning] = useState('')
  const [error, setError] = useState('')
  const [actionNotice, setActionNotice] = useState('')
  const [viewer, setViewer] = useState<{ items: ArtifactViewerItem[]; index: number }>()
  useEffect(() => {
    if (!bundle) { setGalleries([]); setWarning(''); setError(''); return }
    let alive = true
    setGalleries([]); setWarning(''); setError('')
    void api.artifactPresentation(sessionId, bundle.id).then((result) => {
      if (!alive) return
      setGalleries(result.galleries)
      setWarning(result.warning || '')
    }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : 'Não foi possível abrir os artefactos devolvidos.') })
    return () => { alive = false }
  }, [bundle, sessionId])
  const count = galleries.reduce((total, gallery) => total + gallery.items.length, 0)
  if (!bundle || (!count && !error)) return null
  return <><section className="returned-artifact-gallery" aria-label="Artefactos devolvidos pelo ChatGPT">
    <header><span><Icon name="file" size={12}/></span><div><strong>Artefactos devolvidos</strong><small>{count} {count === 1 ? 'ficheiro renderizável' : 'ficheiros renderizáveis'}</small></div></header>
    {warning && <div className="artifact-presentation-warning" role="status">A apresentação declarada não pôde ser usada; foi aplicada a galeria segura automática.</div>}
    {actionNotice && <div className="artifact-action-notice" role="status">{actionNotice}</div>}
    {error ? <div className="composer-error">{error}</div> : <div className="returned-artifact-galleries">{galleries.map((gallery) => <section className="returned-artifact-group" key={gallery.id}>
      {(gallery.title || gallery.description) && <header><div>{gallery.title && <strong>{gallery.title}</strong>}{gallery.description && <small>{gallery.description}</small>}</div></header>}
      <div className={`returned-artifact-list gallery-layout-${gallery.layout} gallery-sizing-${gallery.sizing}`}>{gallery.items.map((item, index) => {
        const previewPath = item.preview_path || item.path
        return <article className={`returned-artifact-card artifact-kind-${item.kind}`} key={item.path}>
          <button className="returned-artifact-open" type="button" onClick={() => setViewer({ items: gallery.items, index })} aria-label={`Abrir ${item.label || baseName(item.path)}`}>
            <div className="returned-artifact-preview"><ArtifactPreview sessionId={sessionId} path={previewPath} size={item.size} kind={item.kind} compact url={api.artifactEntryURL(sessionId, bundle.id, previewPath)}/></div>
          </button>
          <div className="returned-artifact-heading"><div><strong>{item.label || baseName(item.path)}</strong>{item.description && <span>{item.description}</span>}<small>{formatBytes(item.size)} · {item.kind}</small></div><div className="returned-artifact-actions"><button type="button" onClick={() => requestArtifactIndex('chat', `entry|${bundle.id}|${item.path}`)} title="Indexar no próximo prompt"><Icon name="link" size={12}/> Indexar</button><button type="button" onClick={() => { setActionNotice(''); void api.saveChatFileToLibrary(sessionId, bundle.id, item.path).then(() => setActionNotice(`${item.label || baseName(item.path)} guardado na biblioteca.`)).catch((reason) => setActionNotice(reason instanceof Error ? reason.message : 'Não foi possível guardar na biblioteca.')) }} title="Guardar na biblioteca"><Icon name="save" size={12}/> Biblioteca</button><a href={api.artifactEntryURL(sessionId, bundle.id, item.path, true)} download title={`Descarregar ${item.path}`}><Icon name="download" size={12}/> Descarregar</a></div></div>
        </article>
      })}</div>
    </section>)}</div>}
  </section>{viewer && <ArtifactViewerModal sessionId={sessionId} bundleId={bundle.id} items={viewer.items} initialIndex={viewer.index} onClose={() => setViewer(undefined)}/>}</>
}


type ChatFileView = 'cards' | 'table'

export function ChatArtifactLibrary({ sessionId, artifacts = EMPTY_ARTIFACTS, requestLineages = {} }: { sessionId: string; artifacts?: ArtifactRecord[]; requestLineages?: RequestLineages }) {
  const bundles = useMemo(() => artifacts.filter(isTransportBundleArtifact).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()), [artifacts])
  const [files, setFiles] = useState<ChatFileRecord[]>([])
  const [query, setQuery] = useState('')
  const [view, setView] = useState<ChatFileView>('cards')
  const [selectedBundle, setSelectedBundle] = useState<ArtifactRecord>()
  const [viewer, setViewer] = useState<ChatFileRecord>()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    void api.chatFiles(sessionId).then((result) => { if (alive) setFiles(result.files || []) })
      .catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os ficheiros deste chat.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [sessionId, artifacts])

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pt')
    return files.filter((file) => !needle || `${file.name} ${file.path || ''} ${file.source} ${file.request_id || ''}`.toLocaleLowerCase('pt').includes(needle))
  }, [files, query])
  const visibleBundles = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pt')
    return bundles.filter((bundle) => !needle || `${bundle.name} ${bundle.request_id || ''}`.toLocaleLowerCase('pt').includes(needle))
  }, [bundles, query])

  function indexFile(file: ChatFileRecord) {
    requestArtifactIndex('chat', file.direct ? `artifact|${file.artifact_id}` : `entry|${file.artifact_id}|${file.path || ''}`)
  }

  async function saveToLibrary(file: ChatFileRecord) {
    const key = chatFileKey(file); setSaving(key); setError('')
    try { await api.saveChatFileToLibrary(sessionId, file.artifact_id, file.path || '') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível guardar o ficheiro na biblioteca.') }
    finally { setSaving('') }
  }

  return <section className="chat-artifact-library" aria-label="Ficheiros do chat">
    <header className="chat-artifact-library-header"><div><span><Icon name="folder" size={14}/></span><div><strong>Ficheiros do chat</strong><small>Anexos enviados e ficheiros devolvidos pelo GPT numa única área. Os bundles do protocolo continuam disponíveis separadamente.</small></div></div><div className="chat-artifact-library-counts"><b>{visible.length}</b><span>ficheiros</span><b>{visibleBundles.length}</b><span>bundles</span></div></header>
    <div className="chat-file-toolbar"><label className="panel-search-field"><Icon name="search" size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar ficheiros deste chat…" aria-label="Pesquisar ficheiros deste chat"/></label><div className="file-view-switch"><button type="button" className={view === 'cards' ? 'active' : ''} onClick={() => setView('cards')} title="Cards"><Icon name="package" size={13}/></button><button type="button" className={view === 'table' ? 'active' : ''} onClick={() => setView('table')} title="Tabela"><Icon name="list" size={13}/></button></div></div>
    {error && <div className="composer-error">{error}</div>}
    {loading && <p className="muted-copy">A carregar ficheiros do chat…</p>}
    {view === 'cards' ? <div className="chat-file-grid">{visible.map((file) => <article className="chat-file-card" key={chatFileKey(file)}><button type="button" className="chat-file-preview" onClick={() => setViewer(file)}><ArtifactPreview sessionId={sessionId} path={file.name} size={file.size} compact url={chatFileURL(sessionId, file)}/></button><div className="chat-file-copy"><strong title={file.name}>{file.name}</strong><small>{chatFileSourceLabel(file)} · {formatBytes(file.size)}</small></div><div className="chat-file-actions"><button type="button" onClick={() => indexFile(file)} title="Indexar no próximo prompt"><Icon name="link" size={12}/> Indexar</button><button type="button" onClick={() => void saveToLibrary(file)} disabled={saving === chatFileKey(file)} title="Guardar na biblioteca"><Icon name="save" size={12}/></button><a href={chatFileDownloadURL(sessionId, file)} download={file.name} title="Descarregar"><Icon name="download" size={12}/></a></div></article>)}</div>
      : <div className="chat-file-table"><div className="chat-file-table-head"><span>Nome</span><span>Origem</span><span>Tamanho</span><span>Data</span><span>Ações</span></div>{visible.map((file) => <div className="chat-file-table-row" key={chatFileKey(file)}><button type="button" onClick={() => setViewer(file)}><Icon name="file" size={13}/><span>{file.name}</span></button><span>{chatFileSourceLabel(file)}</span><span>{formatBytes(file.size)}</span><span>{formatDateTime(file.created_at)}</span><span><button type="button" onClick={() => indexFile(file)}>Indexar</button><button type="button" onClick={() => void saveToLibrary(file)} disabled={saving === chatFileKey(file)}>Biblioteca</button><a href={chatFileDownloadURL(sessionId, file)} download={file.name}>Descarregar</a></span></div>)}</div>}
    {!loading && !visible.length && <div className="artifact-preview-empty"><Icon name="file" size={28}/><strong>Nenhum ficheiro neste chat</strong><span>Os anexos enviados e os ficheiros devolvidos pelo GPT aparecerão aqui.</span></div>}
    {visibleBundles.length > 0 && <section className="chat-bundle-strip" aria-label="Bundles do protocolo"><header><strong>Bundles do protocolo</strong><small>Pedidos e respostas integrais para auditoria.</small></header><div>{visibleBundles.map((bundle) => { const presentation = bundlePresentation(bundle, requestLineages); return <button key={bundle.id} type="button" className={`bundle-card bundle-tone-${presentation.tone}`} onClick={() => setSelectedBundle(bundle)}><span className="bundle-kind-mark">{bundle.direction === 'input' ? '↑' : '↓'}</span><span><em>{presentation.label}</em><b>{bundle.name}</b><small>{formatBytes(bundle.size)} · {bundle.entry_count || 0} itens</small></span><Icon name="chevron" size={10}/></button> })}</div></section>}
    {selectedBundle && <BundleExplorer sessionId={sessionId} bundle={selectedBundle} bundles={bundles} requestLineages={requestLineages} onBundle={setSelectedBundle} onClose={() => setSelectedBundle(undefined)}/>}
    {viewer && (viewer.direct
      ? <ArtifactViewerModal sessionId={sessionId} artifactId={viewer.artifact_id} items={[{ path: viewer.name, size: viewer.size, content_type: viewer.content_type }]} initialIndex={0} onClose={() => setViewer(undefined)}/>
      : <ArtifactViewerModal sessionId={sessionId} bundleId={viewer.artifact_id} items={[{ path: viewer.path || viewer.name, size: viewer.size, content_type: viewer.content_type }]} initialIndex={0} onClose={() => setViewer(undefined)}/>)}
  </section>
}

function chatFileKey(file: ChatFileRecord) { return `${file.artifact_id}:${file.path || ''}` }
function chatFileSourceLabel(file: ChatFileRecord) { if (file.source === 'attachment') return 'Anexo enviado'; if (file.source === 'returned') return 'Ficheiro devolvido'; return file.direction === 'input' ? 'Entrada' : 'Saída' }
function chatFileURL(sessionId: string, file: ChatFileRecord) { return file.direct ? api.artifactURL(sessionId, file.artifact_id, true) : api.artifactEntryURL(sessionId, file.artifact_id, file.path || '') }
function chatFileDownloadURL(sessionId: string, file: ChatFileRecord) { return file.direct ? api.artifactURL(sessionId, file.artifact_id) : api.artifactEntryURL(sessionId, file.artifact_id, file.path || '', true) }

export function ComposerBundlePreviewExplorer({ sessionId, bundle, onClose }: { sessionId: string; bundle: ArtifactRecord; onClose: () => void }) {
  return <BundleExplorer sessionId={sessionId} bundle={bundle} bundles={[bundle]} requestLineages={{}} presentationOverride={{ tone: 'request-main', label: 'Pré-visualização · próximo bundle' }} onBundle={() => undefined} onClose={onClose}/>
}

export function BundleExplorerModal({ sessionId, bundle, onClose }: { sessionId: string; bundle: ArtifactRecord; onClose: () => void }) {
  return <BundleExplorer sessionId={sessionId} bundle={bundle} bundles={[bundle]} requestLineages={{}} onBundle={() => undefined} onClose={onClose}/>
}

function BundleExplorer({ sessionId, bundle, bundles, requestLineages, presentationOverride, onBundle, onClose }: { sessionId: string; bundle: ArtifactRecord; bundles: ArtifactRecord[]; requestLineages: RequestLineages; presentationOverride?: BundlePresentation; onBundle: (bundle: ArtifactRecord) => void; onClose: () => void }) {
  const [entries, setEntries] = useState<ArtifactEntry[]>([]); const [currentDir, setCurrentDir] = useState(''); const [path, setPath] = useState(''); const [viewerIndex, setViewerIndex] = useState<number>(); const [loading, setLoading] = useState(false); const [error, setError] = useState('')
  useEffect(() => { let alive = true; setLoading(true); setError(''); setCurrentDir(''); setPath(''); void api.artifactEntries(sessionId, bundle.id).then((result) => { if (alive) setEntries(result.entries) }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : 'Não foi possível abrir o bundle.') }).finally(() => { if (alive) setLoading(false) }); return () => { alive = false } }, [bundle.id, sessionId])
  const tree = useMemo(() => directoryEntries(entries, currentDir), [entries, currentDir]); const breadcrumbs = useMemo(() => directoryBreadcrumbs(currentDir), [currentDir]); const files = useMemo(() => entries.filter((entry) => !entry.dir), [entries]); const selectedEntry = entries.find((entry) => entry.path === path); const selectedPresentation = presentationOverride || bundlePresentation(bundle, requestLineages)
  function openEntry(entry: ArtifactEntry) { if (entry.dir) { setCurrentDir(entry.path.replace(/\/$/, '')); setPath(''); setError(''); return }; setPath(entry.path); setError('') }
  return createPortal(<div className="bundle-explorer-backdrop" data-chatgpt-overlay-blocker="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="bundle-explorer" role="dialog" aria-modal="true" aria-label={`Explorar ${bundle.name}`}>
    <header><div><span className={`bundle-kind-mark bundle-tone-${selectedPresentation.tone}`}>{bundle.direction === 'input' ? '↑' : '↓'}</span><div><span className={`bundle-kind-label bundle-tone-${selectedPresentation.tone}`}>{selectedPresentation.label}</span><strong>{bundle.name}</strong><small>{formatBytes(bundle.size)} · {formatDateTime(bundle.created_at)} · SHA-256 {bundle.sha256.slice(0, 12)}…</small></div></div><div><a className="secondary-button" href={api.artifactURL(sessionId, bundle.id)} download={bundle.name}><Icon name="download" size={13}/> Bundle inteiro</a><button className="icon-button light" onClick={onClose} aria-label="Fechar explorador"><Icon name="close" size={13}/></button></div></header>
    <div className="bundle-explorer-layout"><aside><div className="bundle-selector">{bundles.map((item) => { const presentation = item.id === bundle.id && presentationOverride ? presentationOverride : bundlePresentation(item, requestLineages); return <button key={item.id} className={`${item.id === bundle.id ? 'active ' : ''}bundle-tone-${presentation.tone}`} onClick={() => onBundle(item)}><span className="bundle-selector-mark">{item.direction === 'input' ? '↑' : '↓'}</span><span><em>{presentation.label}</em><b>{item.name}</b><small>{formatBytes(item.size)} · {formatDateTime(item.created_at)}</small></span></button> })}</div></aside>
      <main><div className="bundle-file-list"><div className="bundle-list-heading"><div className="bundle-breadcrumbs">{breadcrumbs.map((crumb, index) => <button key={crumb.path || '/'} type="button" onClick={() => { setCurrentDir(crumb.path); setPath('') }}>{index ? '› ' : ''}{crumb.label}</button>)}</div><span>{tree.length} itens</span></div>{loading ? <p className="muted-copy">A carregar…</p> : error && !entries.length ? <p className="composer-error">{error}</p> : tree.map((entry) => <div key={entry.path} className={`bundle-file-row ${entry.path === path ? 'active' : ''}`}><button type="button" onClick={() => openEntry(entry)}><Icon name={entry.dir ? 'folder' : 'file'} size={12}/><span>{baseName(entry.path)}</span><small>{entry.dir ? 'pasta' : formatBytes(entry.size)}</small></button>{!entry.dir && <a href={api.artifactEntryURL(sessionId, bundle.id, entry.path, true)} download title="Descarregar ficheiro" aria-label={`Descarregar ${entry.path}`}><Icon name="download" size={11}/></a>}</div>)}</div>
        <section className="bundle-preview"><div><strong>{path || 'Pré-visualização'}</strong>{path && <span className="bundle-preview-actions"><button type="button" onClick={() => setViewerIndex(Math.max(0, files.findIndex((entry) => entry.path === path)))}>Abrir viewer</button><a href={api.artifactEntryURL(sessionId, bundle.id, path, true)} download>Descarregar</a></span>}</div>{path ? <ArtifactPreview sessionId={sessionId} path={path} size={selectedEntry?.size || 0} url={api.artifactEntryURL(sessionId, bundle.id, path)}/> : <p>Selecione um ficheiro para pré-visualizar ou descarregar.</p>}{error && entries.length ? <span className="composer-error">{error}</span> : null}</section></main>
    </div>
    {viewerIndex !== undefined && <ArtifactViewerModal sessionId={sessionId} bundleId={bundle.id} items={files.map((entry) => ({ path: entry.path, size: entry.size }))} initialIndex={viewerIndex} onClose={() => setViewerIndex(undefined)}/>}
  </section></div>, document.body)
}

function isTransportBundleArtifact(item: ArtifactRecord) {
  if (item.kind !== 'bundle' || !item.bundle || !item.request_id) return false
  const parsed = parseBundleName(item.name) || parseBundleNameWithDuplicateSuffix(item.name)
  if (!parsed) return false
  const expectedDirection = parsed.kind === 'req' ? 'input' : 'output'
  const effectiveRequestId = parsed.subrequestId || parsed.requestId
  return item.direction === expectedDirection && item.request_id === effectiveRequestId
}

function bundlePresentation(bundle: ArtifactRecord, requestLineages: RequestLineages): BundlePresentation {
  const lineageKind = bundle.request_id ? requestLineages[bundle.request_id]?.kind : undefined
  if (lineageKind === 'knowledge_review') return bundle.direction === 'input' ? { tone: 'request-summary', label: 'Pedido · resumo final' } : { tone: 'final-summary', label: 'Resumo final' }
  if (bundle.direction === 'output') return { tone: 'response', label: 'Resposta' }
  if (lineageKind === 'revert_restore') return { tone: 'request-restore', label: 'Pedido · repor reversão' }
  if (!lineageKind || lineageKind === 'standard') return { tone: 'request-main', label: 'Pedido principal' }
  return { tone: 'request-repair', label: 'Pedido · correção' }
}

function directoryEntries(entries: ArtifactEntry[], currentDir: string) { const prefix = currentDir ? `${currentDir.replace(/\/$/, '')}/` : ''; const visible = new Map<string, ArtifactEntry>(); for (const entry of entries) { const clean = entry.path.replace(/^\/+/, ''); if (!clean.startsWith(prefix)) continue; const rest = clean.slice(prefix.length); if (!rest) continue; const parts = rest.split('/').filter(Boolean); if (!parts.length) continue; if (parts.length > 1 || entry.dir) { const folderPath = `${prefix}${parts[0]}`; if (!visible.has(folderPath)) visible.set(folderPath, { path: folderPath, size: 0, dir: true }); continue }; visible.set(clean, { ...entry, path: clean }) }; return [...visible.values()].sort((a, b) => Number(b.dir) - Number(a.dir) || a.path.localeCompare(b.path)) }
function directoryBreadcrumbs(currentDir: string) { const result = [{ label: '/', path: '' }]; const parts = currentDir.split('/').filter(Boolean); for (let index = 0; index < parts.length; index += 1) result.push({ label: parts[index], path: parts.slice(0, index + 1).join('/') }); return result }
function baseName(path: string) { return path.replace(/\/$/, '').split('/').pop() || path }
function formatDateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('pt-PT', { dateStyle: 'short', timeStyle: 'medium' }).format(date) }
