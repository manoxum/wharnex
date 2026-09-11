import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ArtifactEntry, ArtifactPresentationGallery, ArtifactRecord, Session } from '../types'
import { api } from '../lib/api'
import { formatBytes } from '../lib/desktop'
import { parseBundleName, parseBundleNameWithDuplicateSuffix } from '../lib/bundlename'
import { Icon } from './Icon'
import { ArtifactPreview } from './ArtifactPreview'
import { ArtifactViewerModal, type ArtifactViewerItem } from './ArtifactViewerModal'

type RequestLineages = NonNullable<Session['request_lineages']>
type BundleTone = 'request-main' | 'request-repair' | 'request-restore' | 'request-summary' | 'response' | 'final-summary'
type BundlePresentation = { tone: BundleTone; label: string }
const EMPTY_ARTIFACTS: ArtifactRecord[] = []

export function BundleExchangeBar({ sessionId, artifacts = [], requestLineages = {} }: { sessionId: string; artifacts?: ArtifactRecord[]; requestLineages?: RequestLineages }) {
  const bundles = useMemo(() => artifacts.filter(isTransportBundleArtifact).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()), [artifacts])
  const counts = useMemo(() => ({ input: bundles.filter((item) => item.direction === 'input').length, output: bundles.filter((item) => item.direction === 'output').length }), [bundles])
  const [selected, setSelected] = useState<ArtifactRecord>()
  if (!bundles.length) return null
  const summaryLabel = `Abrir galeria completa: ${bundles.length} ${bundles.length === 1 ? 'bundle' : 'bundles'}, ${counts.input} ${counts.input === 1 ? 'enviado' : 'enviados'}, ${counts.output} ${counts.output === 1 ? 'recebido' : 'recebidos'}`
  return <><section className="bundle-exchange-bar" aria-label="Galeria de bundles trocados com o ChatGPT">
    <button className="bundle-exchange-summary" type="button" onClick={() => setSelected(bundles[0])} title={summaryLabel} aria-label={summaryLabel}><span className="bundle-exchange-icon"><Icon name="folder" size={13}/></span><span className="bundle-exchange-stats"><b title="Total">{bundles.length}</b><i title="Enviados">↑{counts.input}</i><i title="Recebidos">↓{counts.output}</i></span></button>
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
    {error ? <div className="composer-error">{error}</div> : <div className="returned-artifact-galleries">{galleries.map((gallery) => <section className="returned-artifact-group" key={gallery.id}>
      {(gallery.title || gallery.description) && <header><div>{gallery.title && <strong>{gallery.title}</strong>}{gallery.description && <small>{gallery.description}</small>}</div></header>}
      <div className={`returned-artifact-list gallery-layout-${gallery.layout} gallery-sizing-${gallery.sizing}`}>{gallery.items.map((item, index) => {
        const previewPath = item.preview_path || item.path
        return <article className={`returned-artifact-card artifact-kind-${item.kind}`} key={item.path}>
          <button className="returned-artifact-open" type="button" onClick={() => setViewer({ items: gallery.items, index })} aria-label={`Abrir ${item.label || baseName(item.path)}`}>
            <div className="returned-artifact-preview"><ArtifactPreview sessionId={sessionId} path={previewPath} size={item.size} kind={item.kind} compact url={api.artifactEntryURL(sessionId, bundle.id, previewPath)}/></div>
          </button>
          <div className="returned-artifact-heading"><div><strong>{item.label || baseName(item.path)}</strong>{item.description && <span>{item.description}</span>}<small>{formatBytes(item.size)} · {item.kind}</small></div><a href={api.artifactEntryURL(sessionId, bundle.id, item.path, true)} download title={`Descarregar ${item.path}`}><Icon name="download" size={12}/> Descarregar</a></div>
        </article>
      })}</div>
    </section>)}</div>}
  </section>{viewer && <ArtifactViewerModal sessionId={sessionId} bundleId={bundle.id} items={viewer.items} initialIndex={viewer.index} onClose={() => setViewer(undefined)}/>}</>
}


type ReturnedArtifactRef = { bundle: ArtifactRecord; entry: ArtifactEntry }

export function ChatArtifactLibrary({ sessionId, artifacts = EMPTY_ARTIFACTS, requestLineages = {} }: { sessionId: string; artifacts?: ArtifactRecord[]; requestLineages?: RequestLineages }) {
  const bundles = useMemo(() => artifacts.filter(isTransportBundleArtifact).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()), [artifacts])
  const outputBundles = useMemo(() => bundles.filter((item) => item.direction === 'output'), [bundles])
  const [returned, setReturned] = useState<ReturnedArtifactRef[]>([])
  const [selectedBundle, setSelectedBundle] = useState<ArtifactRecord>()
  const [selectedFile, setSelectedFile] = useState<ReturnedArtifactRef>()
  const [viewer, setViewer] = useState<{ bundle: ArtifactRecord; items: ArtifactViewerItem[]; index: number }>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!outputBundles.length) {
      setReturned([]); setSelectedFile(undefined); setLoading(false); setError('')
      return
    }
    let alive = true
    setLoading(true); setError('')
    void Promise.all(outputBundles.map(async (bundle) => {
      const result = await api.artifactEntries(sessionId, bundle.id)
      return result.entries.filter(isReturnedArtifactEntry).map((entry) => ({ bundle, entry }))
    })).then((groups) => {
      if (!alive) return
      const next = groups.flat()
      setReturned(next)
      setSelectedFile((current) => current ? next.find((item) => sameReturnedArtifact(item, current)) || next[0] : next[0])
    }).catch((reason) => {
      if (alive) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os ficheiros devolvidos pelo ChatGPT.')
    }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [outputBundles, sessionId])

  const selectedPresentation = selectedFile ? bundlePresentation(selectedFile.bundle, requestLineages) : undefined
  const selectedPath = selectedFile?.entry.path || ''
  const selectedURL = selectedFile ? api.artifactEntryURL(sessionId, selectedFile.bundle.id, selectedFile.entry.path) : ''

  return <section className="chat-artifact-library" aria-label="Ficheiros e bundles do chat">
    <header className="chat-artifact-library-header"><div><span><Icon name="folder" size={14}/></span><div><strong>Ficheiros e bundles</strong><small>Conteúdo trocado com o ChatGPT e artefactos locais devolvidos em artifacts/.</small></div></div><div className="chat-artifact-library-counts"><b>{bundles.length}</b><span>bundles</span><b>{returned.length}</b><span>ficheiros</span></div></header>
    <div className="chat-artifact-library-layout">
      <aside>
        <section className="chat-artifact-library-section"><header><strong>Bundles</strong><span>{bundles.length}</span></header>{bundles.length ? <div className="chat-artifact-library-list">{bundles.map((bundle) => {
          const presentation = bundlePresentation(bundle, requestLineages)
          return <button key={bundle.id} className={`chat-artifact-bundle-row bundle-tone-${presentation.tone}`} type="button" onClick={() => setSelectedBundle(bundle)} title={`Explorar ${bundle.name}`}><span className="bundle-selector-mark">{bundle.direction === 'input' ? '↑' : '↓'}</span><span><em>{presentation.label}</em><b>{bundle.name}</b><small>{formatBytes(bundle.size)} · {formatDateTime(bundle.created_at)}</small></span><Icon name="chevron" size={10}/></button>
        })}</div> : <div className="chat-artifact-library-empty">Nenhum bundle trocado neste chat.</div>}</section>
        <section className="chat-artifact-library-section"><header><strong>Ficheiros do ChatGPT</strong><span>{returned.length}</span></header>{loading ? <div className="chat-artifact-library-empty"><span className="spinner"/> A carregar ficheiros…</div> : error ? <div className="chat-artifact-library-empty composer-error">{error}</div> : returned.length ? <div className="chat-artifact-library-list">{returned.map((item) => {
          const active = selectedFile && sameReturnedArtifact(item, selectedFile)
          const presentation = bundlePresentation(item.bundle, requestLineages)
          return <button key={`${item.bundle.id}:${item.entry.path}`} className={`chat-artifact-file-row ${active ? 'active' : ''}`} type="button" onClick={() => setSelectedFile(item)} title={`Pré-visualizar ${item.entry.path}`}><Icon name="file" size={12}/><span><b>{baseName(item.entry.path)}</b><small>{presentation.label} · {formatBytes(item.entry.size)}</small></span></button>
        })}</div> : <div className="chat-artifact-library-empty">O ChatGPT ainda não devolveu ficheiros em artifacts/.</div>}</section>
      </aside>
      <main className="chat-artifact-library-preview">{selectedFile ? <><header><div><span className={`bundle-kind-label bundle-tone-${selectedPresentation?.tone || 'response'}`}>{selectedPresentation?.label || 'Resposta'}</span><strong>{baseName(selectedPath)}</strong><small>{selectedPath} · {formatBytes(selectedFile.entry.size)}</small></div><div className="artifact-library-preview-actions"><button type="button" className="text-button" onClick={() => { const group = returned.filter((candidate) => candidate.bundle.id === selectedFile.bundle.id); setViewer({ bundle: selectedFile.bundle, items: group.map((candidate) => ({ path: candidate.entry.path, size: candidate.entry.size })), index: Math.max(0, group.findIndex((candidate) => sameReturnedArtifact(candidate, selectedFile))) }) }}>Abrir viewer</button><a href={api.artifactEntryURL(sessionId, selectedFile.bundle.id, selectedPath, true)} download title={`Descarregar ${selectedPath}`}><Icon name="download" size={12}/> Descarregar</a></div></header><div><ArtifactPreview sessionId={sessionId} path={selectedPath} size={selectedFile.entry.size} url={selectedURL}/></div></> : <div className="artifact-preview-empty"><Icon name="file" size={28}/><strong>Sem ficheiro selecionado</strong><span>Os artefactos devolvidos pelo ChatGPT aparecem aqui para pré-visualização e download.</span></div>}</main>
    </div>
    {selectedBundle && <BundleExplorer sessionId={sessionId} bundle={selectedBundle} bundles={bundles} requestLineages={requestLineages} onBundle={setSelectedBundle} onClose={() => setSelectedBundle(undefined)}/>}
    {viewer && <ArtifactViewerModal sessionId={sessionId} bundleId={viewer.bundle.id} items={viewer.items} initialIndex={viewer.index} onClose={() => setViewer(undefined)}/>}
  </section>
}

function sameReturnedArtifact(left: ReturnedArtifactRef, right: ReturnedArtifactRef) {
  return left.bundle.id === right.bundle.id && left.entry.path === right.entry.path
}

function isReturnedArtifactEntry(entry: ArtifactEntry) {
  const clean = entry.path.replace(/^\/+/, '')
  return !entry.dir && clean.startsWith('artifacts/') && clean.length > 'artifacts/'.length
}

function BundleExplorer({ sessionId, bundle, bundles, requestLineages, onBundle, onClose }: { sessionId: string; bundle: ArtifactRecord; bundles: ArtifactRecord[]; requestLineages: RequestLineages; onBundle: (bundle: ArtifactRecord) => void; onClose: () => void }) {
  const [entries, setEntries] = useState<ArtifactEntry[]>([]); const [currentDir, setCurrentDir] = useState(''); const [path, setPath] = useState(''); const [viewerIndex, setViewerIndex] = useState<number>(); const [loading, setLoading] = useState(false); const [error, setError] = useState('')
  useEffect(() => { let alive = true; setLoading(true); setError(''); setCurrentDir(''); setPath(''); void api.artifactEntries(sessionId, bundle.id).then((result) => { if (alive) setEntries(result.entries) }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : 'Não foi possível abrir o bundle.') }).finally(() => { if (alive) setLoading(false) }); return () => { alive = false } }, [bundle.id, sessionId])
  const tree = useMemo(() => directoryEntries(entries, currentDir), [entries, currentDir]); const breadcrumbs = useMemo(() => directoryBreadcrumbs(currentDir), [currentDir]); const files = useMemo(() => entries.filter((entry) => !entry.dir), [entries]); const selectedEntry = entries.find((entry) => entry.path === path); const selectedPresentation = bundlePresentation(bundle, requestLineages)
  function openEntry(entry: ArtifactEntry) { if (entry.dir) { setCurrentDir(entry.path.replace(/\/$/, '')); setPath(''); setError(''); return }; setPath(entry.path); setError('') }
  return createPortal(<div className="bundle-explorer-backdrop" data-chatgpt-overlay-blocker="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="bundle-explorer" role="dialog" aria-modal="true" aria-label={`Explorar ${bundle.name}`}>
    <header><div><span className={`bundle-kind-mark bundle-tone-${selectedPresentation.tone}`}>{bundle.direction === 'input' ? '↑' : '↓'}</span><div><span className={`bundle-kind-label bundle-tone-${selectedPresentation.tone}`}>{selectedPresentation.label}</span><strong>{bundle.name}</strong><small>{formatBytes(bundle.size)} · {formatDateTime(bundle.created_at)} · SHA-256 {bundle.sha256.slice(0, 12)}…</small></div></div><div><a className="secondary-button" href={api.artifactURL(sessionId, bundle.id)} download={bundle.name}><Icon name="download" size={13}/> Bundle inteiro</a><button className="icon-button light" onClick={onClose} aria-label="Fechar explorador"><Icon name="close" size={13}/></button></div></header>
    <div className="bundle-explorer-layout"><aside><div className="bundle-selector">{bundles.map((item) => { const presentation = bundlePresentation(item, requestLineages); return <button key={item.id} className={`${item.id === bundle.id ? 'active ' : ''}bundle-tone-${presentation.tone}`} onClick={() => onBundle(item)}><span className="bundle-selector-mark">{item.direction === 'input' ? '↑' : '↓'}</span><span><em>{presentation.label}</em><b>{item.name}</b><small>{formatBytes(item.size)} · {formatDateTime(item.created_at)}</small></span></button> })}</div></aside>
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
