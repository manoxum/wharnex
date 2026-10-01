import { memo, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ArtifactEntry, ArtifactPresentationGallery, ArtifactRecord, ChatFileRecord, Session } from '../../../types'
import { api } from '../../../lib/transport/http/api'
import { formatBytes } from '../../../lib/desktop/bridge/desktop'
import { parseBundleName, parseBundleNameWithDuplicateSuffix } from '../../../lib/artifacts/bundles/bundlename'
import { Icon } from '../../presentation/chrome/Icon'
import { ContentSkeleton } from '../../presentation/chrome/Skeleton'
import { InternalWindow } from '../../workspace/window/InternalWindow'
import { artifactIndexMarker, requestArtifactIndex } from '../../../lib/artifacts/bundles/artifactIndexing'
import { ArtifactPreview } from './ArtifactPreview'
import { ArtifactViewerModal, type ArtifactViewerItem } from './ArtifactViewerModal'

type RequestLineages = NonNullable<Session['request_lineages']>
type BundleTone = 'main-request' | 'response' | 'correction' | 'adjustment' | 'debug-ping' | 'debug-pong' | 'plan' | 'plan-approval' | 'plan-correction' | 'restore' | 'improvement' | 'conflict' | 'knowledge-review' | 'knowledge-consolidation' | 'final-summary' | 'clarification' | 'investigation' | 'blocked' | 'request'
type BundlePresentation = { tone: BundleTone; label: string }
const BUNDLE_PRESENTATIONS: Record<string, BundlePresentation> = {
  main_request: { tone: 'main-request', label: 'main_request' }, response: { tone: 'response', label: 'response' },
  correction: { tone: 'correction', label: 'correction' }, adjustment: { tone: 'adjustment', label: 'adjustment' }, debug_ping: { tone: 'debug-ping', label: 'debug_ping' }, debug_pong: { tone: 'debug-pong', label: 'debug_pong' },
  plan: { tone: 'plan', label: 'plan' }, plan_approval: { tone: 'plan-approval', label: 'plan_approval' }, plan_correction: { tone: 'plan-correction', label: 'plan_correction' },
  revert_restore: { tone: 'restore', label: 'revert_restore' }, improvement: { tone: 'improvement', label: 'improvement' }, conflict: { tone: 'conflict', label: 'conflict' },
  knowledge_review: { tone: 'knowledge-review', label: 'knowledge_review' }, knowledge_consolidation: { tone: 'knowledge-consolidation', label: 'knowledge_consolidation' },
  final_summary: { tone: 'final-summary', label: 'final_summary' }, clarification: { tone: 'clarification', label: 'clarification' },
  investigation: { tone: 'investigation', label: 'investigation' }, blocked: { tone: 'blocked', label: 'blocked' }, request: { tone: 'request', label: 'request' },
}
const EMPTY_ARTIFACTS: ArtifactRecord[] = []

export const BundleExchangeBar = memo(function BundleExchangeBar({ sessionId, artifacts = [], requestLineages = {} }: { sessionId: string; artifacts?: ArtifactRecord[]; requestLineages?: RequestLineages }) {
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
})

export const ReturnedArtifactGallery = memo(function ReturnedArtifactGallery({ sessionId, artifacts = [], requestId }: { sessionId: string; artifacts?: ArtifactRecord[]; requestId: string }) {
  const bundle = useMemo(() => artifacts.filter((item) => isTransportBundleArtifact(item) && item.direction === 'output' && item.request_id === requestId).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0], [artifacts, requestId])
  const [galleries, setGalleries] = useState<ArtifactPresentationGallery[]>([])
  const [warning, setWarning] = useState('')
  const [error, setError] = useState('')
  const [actionNotice, setActionNotice] = useState('')
  const [viewer, setViewer] = useState<{ items: ArtifactViewerItem[]; index: number }>()
  const bundleId = bundle?.id
  useEffect(() => {
    if (!bundleId) { setGalleries([]); setWarning(''); setError(''); return }
    let alive = true
    setGalleries([]); setWarning(''); setError('')
    void api.artifactPresentation(sessionId, bundleId).then((result) => {
      if (!alive) return
      setGalleries(result.galleries)
      setWarning(result.warning || '')
    }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : 'Não foi possível abrir os artefactos devolvidos.') })
    return () => { alive = false }
  }, [bundleId, sessionId])
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
            <div className="returned-artifact-preview"><ArtifactPreview sessionId={sessionId} path={previewPath} size={item.size} kind={item.preview_path ? undefined : item.kind} compact url={api.artifactEntryURL(sessionId, bundle.id, previewPath)}/></div>
          </button>
          <div className="returned-artifact-heading"><div><strong>{item.label || baseName(item.path)}</strong>{item.description && <span>{item.description}</span>}<small>{formatBytes(item.size)} · {item.kind}</small></div><div className="returned-artifact-actions"><button type="button" onClick={() => requestArtifactIndex('chat', `entry|${bundle.id}|${item.path}`)} title="Indexar no próximo prompt"><Icon name="link" size={12}/> Indexar</button><button type="button" onClick={() => { setActionNotice(''); void api.saveChatFileToLibrary(sessionId, bundle.id, item.path).then(() => setActionNotice(`${item.label || baseName(item.path)} guardado na biblioteca.`)).catch((reason) => setActionNotice(reason instanceof Error ? reason.message : 'Não foi possível guardar na biblioteca.')) }} title="Guardar na biblioteca"><Icon name="save" size={12}/> Biblioteca</button><a href={api.artifactEntryURL(sessionId, bundle.id, item.path, true)} download title={`Descarregar ${item.path}`}><Icon name="download" size={12}/> Descarregar</a></div></div>
        </article>
      })}</div>
    </section>)}</div>}
  </section>{viewer && <ArtifactViewerModal sessionId={sessionId} bundleId={bundle.id} items={viewer.items} initialIndex={viewer.index} onClose={() => setViewer(undefined)}/>}</>
})


type ChatFileView = 'cards' | 'table'
type ChatFileSortKey = 'name' | 'source' | 'size' | 'date'
type ChatFileSort = { key: ChatFileSortKey; direction: 'asc' | 'desc' }

export function ChatArtifactLibrary({ sessionId, artifacts = EMPTY_ARTIFACTS, requestLineages = {} }: { sessionId: string; artifacts?: ArtifactRecord[]; requestLineages?: RequestLineages }) {
  const bundles = useMemo(() => artifacts.filter(isTransportBundleArtifact).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()), [artifacts])
  const [files, setFiles] = useState<ChatFileRecord[]>([])
  const [query, setQuery] = useState('')
  const [view, setView] = useState<ChatFileView>('cards')
  const [sort, setSort] = useState<ChatFileSort>({ key: 'date', direction: 'desc' })
  const [selectedBundle, setSelectedBundle] = useState<ArtifactRecord>()
  const [viewer, setViewer] = useState<ChatFileRecord>()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

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
    return files
      .filter((file) => !needle || `${file.name} ${file.path || ''} ${file.source} ${file.request_id || ''}`.toLocaleLowerCase('pt').includes(needle))
      .sort((left, right) => compareChatFiles(left, right, sort))
  }, [files, query, sort])
  const visibleBundles = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pt')
    return bundles.filter((bundle) => !needle || `${bundle.name} ${bundle.request_id || ''}`.toLocaleLowerCase('pt').includes(needle))
  }, [bundles, query])

  function chatReference(file: ChatFileRecord) {
    return file.direct ? `artifact|${file.artifact_id}` : `entry|${file.artifact_id}|${file.path || ''}`
  }

  function insertChatReference(file: ChatFileRecord) {
    const value = chatReference(file)
    const marker = artifactIndexMarker('chat', value)
    requestArtifactIndex('chat', value)
    setNotice(`${file.name} inserido no composer como @chat.`)
    void navigator.clipboard?.writeText(marker).catch(() => undefined)
  }

  async function saveToLibrary(file: ChatFileRecord) {
    const key = chatFileKey(file); setSaving(key); setError(''); setNotice('')
    try {
      await api.saveChatFileToLibrary(sessionId, file.artifact_id, file.path || '')
      setNotice(`${file.name} guardado na biblioteca.`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível guardar o ficheiro na biblioteca.') }
    finally { setSaving('') }
  }

  function changeSort(key: ChatFileSortKey) {
    setSort((current) => current.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: key === 'date' || key === 'size' ? 'desc' : 'asc' })
  }

  return <section className="chat-artifact-library" aria-label="Ficheiros do chat">
    <header className="chat-artifact-library-header"><div><span><Icon name="folder" size={14}/></span><div><strong>Ficheiros do chat</strong><small>Anexos enviados e ficheiros devolvidos pelo GPT numa única área. Os bundles do protocolo continuam disponíveis separadamente.</small></div></div><div className="chat-artifact-library-counts"><b>{visible.length}</b><span>ficheiros</span><b>{visibleBundles.length}</b><span>bundles</span></div></header>
    <div className="chat-file-toolbar"><label className="panel-search-field"><Icon name="search" size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar ficheiros deste chat…" aria-label="Pesquisar ficheiros deste chat"/></label><div className="file-view-switch" role="group" aria-label="Modo de visualização"><button type="button" className={view === 'cards' ? 'active' : ''} onClick={() => setView('cards')} title="Cards"><Icon name="package" size={13}/></button><button type="button" className={view === 'table' ? 'active' : ''} onClick={() => setView('table')} title="Tabela"><Icon name="list" size={13}/></button></div></div>
    {error && <div className="composer-error">{error}</div>}
    {notice && <div className="artifact-action-notice" role="status">{notice}</div>}
    {loading && !visible.length && <ContentSkeleton label="A carregar ficheiros do chat" rows={5}/>}
    {loading && visible.length ? <div className="audit-history-notice" role="status"><Icon name="history" size={13}/><span>A atualizar ficheiros em segundo plano…</span></div> : null}
    {view === 'cards' ? <div className="chat-file-grid">{visible.map((file) => <article className="chat-file-card" key={chatFileKey(file)}><button type="button" className="chat-file-preview" onClick={() => setViewer(file)} aria-label={`Abrir ${file.name}`}><ChatFileThumbnail sessionId={sessionId} file={file}/></button><div className="chat-file-copy"><strong title={file.name}>{file.name}</strong><small>{chatFileSourceLabel(file)} · {formatBytes(file.size)}</small></div><div className="chat-file-actions"><button type="button" onClick={() => insertChatReference(file)} title="Inserir @chat no composer"><Icon name="link" size={12}/> @chat</button><button type="button" onClick={() => void saveToLibrary(file)} disabled={saving === chatFileKey(file)} title="Guardar na biblioteca"><Icon name="save" size={12}/></button><a href={chatFileDownloadURL(sessionId, file)} download={file.name} title="Descarregar"><Icon name="download" size={12}/></a></div></article>)}</div>
      : <div className="chat-file-table" role="table" aria-label="Tabela de ficheiros do chat"><div className="chat-file-table-head" role="row"><ChatFileSortButton label="Ficheiro" sortKey="name" sort={sort} onSort={changeSort}/><ChatFileSortButton label="Origem" sortKey="source" sort={sort} onSort={changeSort}/><ChatFileSortButton label="Tamanho" sortKey="size" sort={sort} onSort={changeSort}/><ChatFileSortButton label="Data" sortKey="date" sort={sort} onSort={changeSort}/><span role="columnheader">Ações</span></div>{visible.map((file) => <div className="chat-file-table-row" role="row" key={chatFileKey(file)}><button type="button" className="chat-file-table-name" onClick={() => setViewer(file)}><span className="chat-file-table-thumb"><ChatFileThumbnail sessionId={sessionId} file={file} compact/></span><span>{file.name}</span></button><span>{chatFileSourceLabel(file)}</span><span>{formatBytes(file.size)}</span><span>{formatDateTime(file.created_at)}</span><span><button type="button" onClick={() => insertChatReference(file)}>@chat</button><button type="button" onClick={() => void saveToLibrary(file)} disabled={saving === chatFileKey(file)}>Biblioteca</button><a href={chatFileDownloadURL(sessionId, file)} download={file.name}>Descarregar</a></span></div>)}</div>}
    {!loading && !visible.length && <div className="artifact-preview-empty"><Icon name="file" size={28}/><strong>Nenhum ficheiro neste chat</strong><span>Os anexos enviados e os ficheiros devolvidos pelo GPT aparecerão aqui.</span></div>}
    {visibleBundles.length > 0 && <section className="chat-bundle-strip" aria-label="Bundles do protocolo"><header><strong>Bundles do protocolo</strong><small>Pedidos e respostas integrais para auditoria.</small></header><div>{visibleBundles.map((bundle) => { const presentation = bundlePresentation(bundle, requestLineages); return <button key={bundle.id} type="button" className={`bundle-card bundle-tone-${presentation.tone}`} onClick={() => setSelectedBundle(bundle)}><span className="bundle-kind-mark">{bundle.direction === 'input' ? '↑' : '↓'}</span><span><em>{presentation.label}</em><b>{bundle.name}</b><small>{formatBytes(bundle.size)} · {bundle.entry_count || 0} itens</small></span><Icon name="chevron" size={10}/></button> })}</div></section>}
    {selectedBundle && <BundleExplorer sessionId={sessionId} bundle={selectedBundle} bundles={bundles} requestLineages={requestLineages} onBundle={setSelectedBundle} onClose={() => setSelectedBundle(undefined)}/>}
    {viewer && (viewer.direct
      ? <ArtifactViewerModal sessionId={sessionId} artifactId={viewer.artifact_id} items={[{ path: viewer.name, size: viewer.size, content_type: viewer.content_type }]} initialIndex={0} onClose={() => setViewer(undefined)}/>
      : <ArtifactViewerModal sessionId={sessionId} bundleId={viewer.artifact_id} items={[{ path: viewer.path || viewer.name, size: viewer.size, content_type: viewer.content_type }]} initialIndex={0} onClose={() => setViewer(undefined)}/>) }
  </section>
}

function ChatFileSortButton({ label, sortKey, sort, onSort }: { label: string; sortKey: ChatFileSortKey; sort: ChatFileSort; onSort: (key: ChatFileSortKey) => void }) {
  const active = sort.key === sortKey
  return <span role="columnheader" aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}><button type="button" className={active ? 'chat-file-sort active' : 'chat-file-sort'} onClick={() => onSort(sortKey)} aria-label={`Ordenar por ${label.toLocaleLowerCase('pt')}`}>{label}<span aria-hidden="true">{active ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}</span></button></span>
}

function ChatFileThumbnail({ sessionId, file, compact = false }: { sessionId: string; file: ChatFileRecord; compact?: boolean }) {
  const kind = chatFileThumbnailKind(file)
  const url = chatFileURL(sessionId, file)
  if (kind === 'image') return <span className="chat-file-media-thumb"><img src={url} alt="" loading="lazy"/></span>
  if (kind === 'video') return <span className="chat-file-media-thumb"><video src={url} muted playsInline preload="metadata"/></span>
  const label = genericDocumentLabel(file.name)
  return <span className={`chat-file-generic-thumb ${compact ? 'compact' : ''}`}><span><Icon name="file" size={compact ? 14 : 30}/></span><b>{label}</b>{!compact && <small>{genericDocumentCaption(file.name, file.content_type)}</small>}</span>
}

function chatFileThumbnailKind(file: ChatFileRecord): 'image' | 'video' | 'document' {
  const type = (file.content_type || '').toLocaleLowerCase('en')
  const ext = file.name.toLocaleLowerCase('en').split('.').pop() || ''
  if (type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'].includes(ext)) return 'image'
  if (type.startsWith('video/') || ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'avi', 'mkv'].includes(ext)) return 'video'
  return 'document'
}

function genericDocumentLabel(name: string) {
  const ext = name.toLocaleLowerCase('en').split('.').pop() || ''
  if (ext === 'pdf') return 'PDF'
  if (['doc', 'docx', 'odt'].includes(ext)) return 'WORD'
  if (['xls', 'xlsx', 'ods', 'csv'].includes(ext)) return 'SHEET'
  if (['ppt', 'pptx', 'odp'].includes(ext)) return 'SLIDE'
  if (['md', 'mdx', 'markdown'].includes(ext)) return 'MD'
  if (['txt', 'log', 'rtf'].includes(ext)) return 'TXT'
  return ext ? ext.slice(0, 6).toLocaleUpperCase('en') : 'FILE'
}

function genericDocumentCaption(name: string, contentType?: string) {
  const ext = name.split('.').pop()?.toLocaleUpperCase('en')
  return ext && ext.length <= 8 ? `${ext} · documento` : (contentType || 'Documento')
}

function compareChatFiles(left: ChatFileRecord, right: ChatFileRecord, sort: ChatFileSort) {
  let value = 0
  if (sort.key === 'name') value = left.name.localeCompare(right.name, 'pt')
  else if (sort.key === 'source') value = chatFileSourceLabel(left).localeCompare(chatFileSourceLabel(right), 'pt')
  else if (sort.key === 'size') value = left.size - right.size
  else value = Date.parse(left.created_at) - Date.parse(right.created_at)
  return sort.direction === 'asc' ? value : -value
}

function chatFileKey(file: ChatFileRecord) { return `${file.artifact_id}:${file.path || ''}` }
function chatFileSourceLabel(file: ChatFileRecord) { if (file.source === 'attachment') return 'Anexo enviado'; if (file.source === 'returned') return 'Ficheiro devolvido'; return file.direction === 'input' ? 'Entrada' : 'Saída' }
function chatFileURL(sessionId: string, file: ChatFileRecord) { return file.direct ? api.artifactURL(sessionId, file.artifact_id, true) : api.artifactEntryURL(sessionId, file.artifact_id, file.path || '') }
function chatFileDownloadURL(sessionId: string, file: ChatFileRecord) { return file.direct ? api.artifactURL(sessionId, file.artifact_id) : api.artifactEntryURL(sessionId, file.artifact_id, file.path || '', true) }

export function ComposerBundlePreviewExplorer({ sessionId, bundle, onClose }: { sessionId: string; bundle: ArtifactRecord; onClose: () => void }) {
  return <BundleExplorer sessionId={sessionId} bundle={bundle} bundles={[bundle]} requestLineages={{}} presentationOverride={{ tone: 'main-request', label: 'main_request · preview' }} onBundle={() => undefined} onClose={onClose}/>
}

export function BundleExplorerModal({ sessionId, bundle, onClose }: { sessionId: string; bundle: ArtifactRecord; onClose: () => void }) {
  return <BundleExplorer sessionId={sessionId} bundle={bundle} bundles={[bundle]} requestLineages={{}} onBundle={() => undefined} onClose={onClose}/>
}

function BundleExplorer({ sessionId, bundle, bundles, requestLineages, presentationOverride, onBundle, onClose }: { sessionId: string; bundle: ArtifactRecord; bundles: ArtifactRecord[]; requestLineages: RequestLineages; presentationOverride?: BundlePresentation; onBundle: (bundle: ArtifactRecord) => void; onClose: () => void }) {
  const [entries, setEntries] = useState<ArtifactEntry[]>([]); const [currentDir, setCurrentDir] = useState(''); const [path, setPath] = useState(''); const [viewerIndex, setViewerIndex] = useState<number>(); const [loading, setLoading] = useState(false); const [error, setError] = useState('')
  useEffect(() => { let alive = true; setLoading(true); setError(''); setCurrentDir(''); setPath(''); void api.artifactEntries(sessionId, bundle.id).then((result) => { if (alive) setEntries(result.entries) }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : 'Não foi possível abrir o bundle.') }).finally(() => { if (alive) setLoading(false) }); return () => { alive = false } }, [bundle.id, sessionId])
  const tree = useMemo(() => directoryEntries(entries, currentDir), [entries, currentDir]); const breadcrumbs = useMemo(() => directoryBreadcrumbs(currentDir), [currentDir]); const files = useMemo(() => entries.filter((entry) => !entry.dir), [entries]); const selectedEntry = entries.find((entry) => entry.path === path); const selectedPresentation = presentationOverride || bundlePresentation(bundle, requestLineages)
  const bundleBytes = useMemo(() => bundles.reduce((total, item) => total + item.size, 0), [bundles])
  function openEntry(entry: ArtifactEntry) { if (entry.dir) { setCurrentDir(entry.path.replace(/\/$/, '')); setPath(''); setError(''); return }; setPath(entry.path); setError('') }
  return createPortal(<InternalWindow title={`Explorar ${bundle.name}`} onClose={onClose} layerClassName="bundle-explorer-backdrop"><section className="bundle-explorer" role="dialog" aria-modal="false" aria-label={`Explorar ${bundle.name}`}>
    <header><div><span className={`bundle-kind-mark bundle-tone-${selectedPresentation.tone}`}>{bundle.direction === 'input' ? '↑' : '↓'}</span><div><span className={`bundle-kind-label bundle-tone-${selectedPresentation.tone}`}>{selectedPresentation.label}</span><strong>{bundle.name}</strong><small>{formatBytes(bundle.size)} · {formatDateTime(bundle.created_at)} · SHA-256 {bundle.sha256.slice(0, 12)}…</small></div></div><div><a className="secondary-button" href={api.artifactURL(sessionId, bundle.id)} download={bundle.name}><Icon name="download" size={13}/> Bundle inteiro</a><button className="icon-button light" onClick={onClose} aria-label="Fechar explorador"><Icon name="close" size={13}/></button></div></header>
    <div className="bundle-explorer-layout"><aside><div className="bundle-selector">{bundles.map((item) => { const presentation = item.id === bundle.id && presentationOverride ? presentationOverride : bundlePresentation(item, requestLineages); return <button key={item.id} className={`${item.id === bundle.id ? 'active ' : ''}bundle-tone-${presentation.tone}`} onClick={() => onBundle(item)}><span className="bundle-selector-mark">{item.direction === 'input' ? '↑' : '↓'}</span><span><em>{presentation.label}</em><b>{item.name}</b><small>{formatBytes(item.size)} · {formatDateTime(item.created_at)}</small></span></button> })}
      <section className="bundle-selector-summary sticky bottom-0 z-[2] mt-auto grid shrink-0 grid-cols-2 gap-[7px] border-t border-[color:var(--theme-border)] bg-[color:var(--theme-surface)] p-[8px]" aria-label="Resumo dos bundles trocados">
        <span className="min-w-0 rounded-[10px] border border-[color:var(--theme-border-soft)] bg-[color:var(--theme-elevated)] px-[9px] py-[8px]"><small className="block text-[calc(8px*var(--ui-font-scale))] font-semibold leading-[1.2] tracking-[0.03em] text-[color:var(--theme-text-muted)]">Bundles trocados</small><strong className="mt-[3px] block overflow-hidden text-ellipsis whitespace-nowrap text-[calc(11px*var(--ui-font-scale))] font-bold leading-[1.15] text-[color:var(--theme-text)]">{bundles.length}</strong></span>
        <span className="min-w-0 rounded-[10px] border border-[color:var(--theme-border-soft)] bg-[color:var(--theme-elevated)] px-[9px] py-[8px]"><small className="block text-[calc(8px*var(--ui-font-scale))] font-semibold leading-[1.2] tracking-[0.03em] text-[color:var(--theme-text-muted)]">Ocupação em disco</small><strong className="mt-[3px] block overflow-hidden text-ellipsis whitespace-nowrap text-[calc(11px*var(--ui-font-scale))] font-bold leading-[1.15] text-[color:var(--theme-accent)]">{formatBytes(bundleBytes)}</strong></span>
      </section>
    </div></aside>
      <main><div className="bundle-file-list"><div className="bundle-list-heading"><div className="bundle-breadcrumbs">{breadcrumbs.map((crumb, index) => <button key={crumb.path || '/'} type="button" onClick={() => { setCurrentDir(crumb.path); setPath('') }}>{index ? '› ' : ''}{crumb.label}</button>)}</div><span>{tree.length} itens</span></div>{loading ? <p className="muted-copy">A carregar…</p> : error && !entries.length ? <p className="composer-error">{error}</p> : tree.map((entry) => <div key={entry.path} className={`bundle-file-row ${entry.path === path ? 'active' : ''}`}><button type="button" onClick={() => openEntry(entry)}><Icon name={entry.dir ? 'folder' : 'file'} size={12}/><span>{baseName(entry.path)}</span><small>{entry.dir ? 'pasta' : formatBytes(entry.size)}</small></button>{!entry.dir && <a href={api.artifactEntryURL(sessionId, bundle.id, entry.path, true)} download title="Descarregar ficheiro" aria-label={`Descarregar ${entry.path}`}><Icon name="download" size={11}/></a>}</div>)}</div>
        <section className="bundle-preview"><div><strong>{path || 'Pré-visualização'}</strong>{path && <span className="bundle-preview-actions"><button type="button" onClick={() => setViewerIndex(Math.max(0, files.findIndex((entry) => entry.path === path)))}>Abrir viewer</button><a href={api.artifactEntryURL(sessionId, bundle.id, path, true)} download>Descarregar</a></span>}</div>{path ? <ArtifactPreview sessionId={sessionId} path={path} size={selectedEntry?.size || 0} url={api.artifactEntryURL(sessionId, bundle.id, path)}/> : <p>Selecione um ficheiro para pré-visualizar ou descarregar.</p>}{error && entries.length ? <span className="composer-error">{error}</span> : null}</section></main>
    </div>
    {viewerIndex !== undefined && <ArtifactViewerModal sessionId={sessionId} bundleId={bundle.id} items={files.map((entry) => ({ path: entry.path, size: entry.size }))} initialIndex={viewerIndex} onClose={() => setViewerIndex(undefined)}/>}
  </section></InternalWindow>, document.body)
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
  const explicit = presentationForBundleType(bundle.bundle_type)
  if (explicit) return explicit
  const lineageKind = bundle.request_id ? requestLineages[bundle.request_id]?.kind : undefined
  if (lineageKind === 'knowledge_review') return bundle.direction === 'input' ? presentationForBundleType('knowledge_review')! : presentationForBundleType('final_summary')!
  if (bundle.direction === 'output') return presentationForBundleType('response')!
  const inferred: Record<string, string> = {
    standard: 'main_request', plan_approval: 'plan_approval', plan_correction: 'plan_correction', execution_plan_adjustment: 'adjustment', repair: 'correction',
    revert_restore: 'revert_restore', improvement: 'improvement', evidence: 'debug_pong', conflict: 'conflict', knowledge_consolidation: 'knowledge_consolidation',
  }
  return presentationForBundleType(inferred[lineageKind || 'standard'] || 'request')!
}

function presentationForBundleType(bundleType?: string): BundlePresentation | undefined {
  return bundleType ? BUNDLE_PRESENTATIONS[bundleType] : undefined
}

function directoryEntries(entries: ArtifactEntry[], currentDir: string) { const prefix = currentDir ? `${currentDir.replace(/\/$/, '')}/` : ''; const visible = new Map<string, ArtifactEntry>(); for (const entry of entries) { const clean = entry.path.replace(/^\/+/, ''); if (!clean.startsWith(prefix)) continue; const rest = clean.slice(prefix.length); if (!rest) continue; const parts = rest.split('/').filter(Boolean); if (!parts.length) continue; if (parts.length > 1 || entry.dir) { const folderPath = `${prefix}${parts[0]}`; if (!visible.has(folderPath)) visible.set(folderPath, { path: folderPath, size: 0, dir: true }); continue }; visible.set(clean, { ...entry, path: clean }) }; return [...visible.values()].sort((a, b) => Number(b.dir) - Number(a.dir) || a.path.localeCompare(b.path)) }
function directoryBreadcrumbs(currentDir: string) { const result = [{ label: '/', path: '' }]; const parts = currentDir.split('/').filter(Boolean); for (let index = 0; index < parts.length; index += 1) result.push({ label: parts[index], path: parts.slice(0, index + 1).join('/') }); return result }
function baseName(path: string) { return path.replace(/\/$/, '').split('/').pop() || path }
function formatDateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('pt-PT', { dateStyle: 'short', timeStyle: 'medium' }).format(date) }
