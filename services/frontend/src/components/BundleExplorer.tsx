import { useEffect, useMemo, useState } from 'react'
import type { ArtifactEntry, ArtifactRecord, Session } from '../types'
import { api } from '../lib/api'
import { formatBytes } from '../lib/desktop'
import { parseBundleName, parseBundleNameWithDuplicateSuffix } from '../lib/bundlename'
import { Icon } from './Icon'
import { ArtifactPreview } from './ArtifactPreview'

type RequestLineages = NonNullable<Session['request_lineages']>
type BundleTone = 'request-main' | 'request-repair' | 'request-summary' | 'response' | 'final-summary'
type BundlePresentation = { tone: BundleTone; label: string }

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

function BundleExplorer({ sessionId, bundle, bundles, requestLineages, onBundle, onClose }: { sessionId: string; bundle: ArtifactRecord; bundles: ArtifactRecord[]; requestLineages: RequestLineages; onBundle: (bundle: ArtifactRecord) => void; onClose: () => void }) {
  const [entries, setEntries] = useState<ArtifactEntry[]>([]); const [currentDir, setCurrentDir] = useState(''); const [path, setPath] = useState(''); const [loading, setLoading] = useState(false); const [error, setError] = useState('')
  useEffect(() => { let alive = true; setLoading(true); setError(''); setCurrentDir(''); setPath(''); void api.artifactEntries(sessionId, bundle.id).then((result) => { if (alive) setEntries(result.entries) }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : 'Não foi possível abrir o bundle.') }).finally(() => { if (alive) setLoading(false) }); return () => { alive = false } }, [bundle.id, sessionId])
  const tree = useMemo(() => directoryEntries(entries, currentDir), [entries, currentDir]); const breadcrumbs = useMemo(() => directoryBreadcrumbs(currentDir), [currentDir]); const selectedEntry = entries.find((entry) => entry.path === path); const selectedPresentation = bundlePresentation(bundle, requestLineages)
  function openEntry(entry: ArtifactEntry) { if (entry.dir) { setCurrentDir(entry.path.replace(/\/$/, '')); setPath(''); setError(''); return }; setPath(entry.path); setError('') }
  return <div className="bundle-explorer-backdrop" data-chatgpt-overlay-blocker="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="bundle-explorer" role="dialog" aria-modal="true" aria-label={`Explorar ${bundle.name}`}>
    <header><div><span className={`bundle-kind-mark bundle-tone-${selectedPresentation.tone}`}>{bundle.direction === 'input' ? '↑' : '↓'}</span><div><span className={`bundle-kind-label bundle-tone-${selectedPresentation.tone}`}>{selectedPresentation.label}</span><strong>{bundle.name}</strong><small>{formatBytes(bundle.size)} · {formatDateTime(bundle.created_at)} · SHA-256 {bundle.sha256.slice(0, 12)}…</small></div></div><div><a className="secondary-button" href={api.artifactURL(sessionId, bundle.id)} download={bundle.name}><Icon name="download" size={13}/> Bundle inteiro</a><button className="icon-button light" onClick={onClose} aria-label="Fechar explorador"><Icon name="close" size={13}/></button></div></header>
    <div className="bundle-explorer-layout"><aside><div className="bundle-selector">{bundles.map((item) => { const presentation = bundlePresentation(item, requestLineages); return <button key={item.id} className={`${item.id === bundle.id ? 'active ' : ''}bundle-tone-${presentation.tone}`} onClick={() => onBundle(item)}><span className="bundle-selector-mark">{item.direction === 'input' ? '↑' : '↓'}</span><span><em>{presentation.label}</em><b>{item.name}</b><small>{formatBytes(item.size)} · {formatDateTime(item.created_at)}</small></span></button> })}</div></aside>
      <main><div className="bundle-file-list"><div className="bundle-list-heading"><div className="bundle-breadcrumbs">{breadcrumbs.map((crumb, index) => <button key={crumb.path || '/'} type="button" onClick={() => { setCurrentDir(crumb.path); setPath('') }}>{index ? '› ' : ''}{crumb.label}</button>)}</div><span>{tree.length} itens</span></div>{loading ? <p className="muted-copy">A carregar…</p> : error && !entries.length ? <p className="composer-error">{error}</p> : tree.map((entry) => <div key={entry.path} className={`bundle-file-row ${entry.path === path ? 'active' : ''}`}><button type="button" onClick={() => openEntry(entry)}><Icon name={entry.dir ? 'folder' : 'file'} size={12}/><span>{baseName(entry.path)}</span><small>{entry.dir ? 'pasta' : formatBytes(entry.size)}</small></button>{!entry.dir && <a href={api.artifactEntryURL(sessionId, bundle.id, entry.path, true)} download title="Descarregar ficheiro" aria-label={`Descarregar ${entry.path}`}><Icon name="download" size={11}/></a>}</div>)}</div>
        <section className="bundle-preview"><div><strong>{path || 'Pré-visualização'}</strong>{path && <a href={api.artifactEntryURL(sessionId, bundle.id, path, true)} download>Descarregar</a>}</div>{path ? <ArtifactPreview path={path} size={selectedEntry?.size || 0} url={api.artifactEntryURL(sessionId, bundle.id, path)}/> : <p>Selecione um ficheiro para pré-visualizar ou descarregar.</p>}{error && entries.length ? <span className="composer-error">{error}</span> : null}</section></main>
    </div>
  </section></div>
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
  if (!lineageKind || lineageKind === 'standard') return { tone: 'request-main', label: 'Pedido principal' }
  return { tone: 'request-repair', label: 'Pedido · correção' }
}

function directoryEntries(entries: ArtifactEntry[], currentDir: string) { const prefix = currentDir ? `${currentDir.replace(/\/$/, '')}/` : ''; const visible = new Map<string, ArtifactEntry>(); for (const entry of entries) { const clean = entry.path.replace(/^\/+/, ''); if (!clean.startsWith(prefix)) continue; const rest = clean.slice(prefix.length); if (!rest) continue; const parts = rest.split('/').filter(Boolean); if (!parts.length) continue; if (parts.length > 1 || entry.dir) { const folderPath = `${prefix}${parts[0]}`; if (!visible.has(folderPath)) visible.set(folderPath, { path: folderPath, size: 0, dir: true }); continue }; visible.set(clean, { ...entry, path: clean }) }; return [...visible.values()].sort((a, b) => Number(b.dir) - Number(a.dir) || a.path.localeCompare(b.path)) }
function directoryBreadcrumbs(currentDir: string) { const result = [{ label: '/', path: '' }]; const parts = currentDir.split('/').filter(Boolean); for (let index = 0; index < parts.length; index += 1) result.push({ label: parts[index], path: parts.slice(0, index + 1).join('/') }); return result }
function baseName(path: string) { return path.replace(/\/$/, '').split('/').pop() || path }
function formatDateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('pt-PT', { dateStyle: 'short', timeStyle: 'medium' }).format(date) }
