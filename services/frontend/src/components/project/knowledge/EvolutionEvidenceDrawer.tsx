import { EvolutionEvidenceTabs } from './EvolutionEvidenceTabs'
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { api } from '../../../lib/transport/http/api'
import type { EvolutionEvidence, EvolutionKnowledgeRef, Session } from '../../../types'
import { Button } from '../../presentation/workbench'
import { Icon } from '../../presentation/chrome/Icon'
import { EvidenceListPager, EvolutionEventsList, EvidenceHeader, EvidenceFilters, eventSearchText } from './evidence'

type Props = {
  session: Session
  busy: boolean
  onAnalyze: (ids: string[], knowledgeRefs?: EvolutionKnowledgeRef[], files?: File[], knowledgeOnly?: boolean) => Promise<void>
  onClose: () => void
}

type Source = 'events' | 'knowledge' | 'external'
const EVIDENCE_PAGE_SIZE = 100

const knowledgeCategoryLabel: Record<string, string> = {
  conflict_resolution: 'Conflitos', patch_strategy: 'Patches', execution_repair: 'Reparação', verification: 'Verificação',
  runtime_environment: 'Runtime', protocol_transport: 'Protocolo', product_domain: 'Domínio', general: 'Geral',
}

function knowledgeKey(projectPath: string, id: string) { return `${projectPath}::${id}` }

export function EvolutionEvidenceDrawer({ session, busy, onAnalyze, onClose }: Props) {
  const [evidence, setEvidence] = useState<EvolutionEvidence>()
  const [error, setError] = useState('')
  const [source, setSource] = useState<Source>('events')
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set())
  const [selectedKnowledge, setSelectedKnowledge] = useState<Set<string>>(new Set())
  const [project, setProject] = useState('')
  const [category, setCategory] = useState('')
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [knowledgeOnly, setKnowledgeOnly] = useState(false)
  const [visibleEvidence, setVisibleEvidence] = useState({ key: '', count: EVIDENCE_PAGE_SIZE })
  const uploadRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    api.evolutionEvidence(session.id)
      .then((value) => { if (alive) setEvidence(value) })
      .catch((cause) => { if (alive) setError(String(cause instanceof Error ? cause.message : cause)) })
    return () => { alive = false }
  }, [session.id])

  const filteredEvents = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    return (evidence?.events || []).filter((event) => (!project || event.project_path === project) && (!category || event.category === category) &&
      (!term || `${event.type}\n${event.project_name || event.project_path}\n${eventSearchText(event)}`.toLocaleLowerCase().includes(term)))
  }, [evidence, project, category, query])

  const filteredKnowledge = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    return (evidence?.knowledge || []).filter((entry) => (!project || entry.project_path === project) && (!category || entry.category === category) &&
      (!term || `${entry.id}\n${entry.excerpt}\n${entry.project_name || entry.project_path}`.toLocaleLowerCase().includes(term)))
  }, [evidence, project, category, query])

  const categories = source === 'events' ? evidence?.categories || [] : source === 'knowledge' ? evidence?.knowledge_categories || [] : []
  const listKey = `${source}\u0000${project}\u0000${category}\u0000${query}`
  const visibleLimit = visibleEvidence.key === listKey ? visibleEvidence.count : EVIDENCE_PAGE_SIZE
  const orderedEvents = useMemo(() => filteredEvents.slice().reverse(), [filteredEvents])
  const visibleEvents = orderedEvents.slice(0, visibleLimit)
  const orderedKnowledge = useMemo(() => filteredKnowledge.slice().reverse(), [filteredKnowledge])
  const visibleKnowledge = orderedKnowledge.slice(0, visibleLimit)
  const selectedCount = selectedEvents.size + selectedKnowledge.size
  const dossierCount = selectedCount + files.length
  const visibleKeys = source === 'events' ? filteredEvents.map((event) => event.id) :
    source === 'knowledge' ? filteredKnowledge.map((entry) => knowledgeKey(entry.project_path, entry.id)) : []
  const allSelected = visibleKeys.length > 0 && visibleKeys.every((id) => source === 'events' ? selectedEvents.has(id) : selectedKnowledge.has(id))
  const showMore = () => setVisibleEvidence({ key: listKey, count: Math.min(visibleLimit + EVIDENCE_PAGE_SIZE, source === 'events' ? orderedEvents.length : orderedKnowledge.length) })
  const toggleEvent = useCallback((id: string) => setSelectedEvents((current) => toggleSet(current, id)), [])

  function switchSource(next: Source) { setSource(next); setCategory(''); setQuery('') }

  function toggleAll() {
    if (source === 'external') return
    const update = source === 'events' ? setSelectedEvents : setSelectedKnowledge
    update((current) => {
      const next = new Set(current)
      for (const id of visibleKeys) { if (allSelected) next.delete(id); else next.add(id) }
      return next
    })
  }

  function addFiles(incoming: FileList | null) {
    if (!incoming?.length) return
    const merged = new Map(files.map((file) => [`${file.name}:${file.size}:${file.lastModified}`, file]))
    for (const file of Array.from(incoming)) merged.set(`${file.name}:${file.size}:${file.lastModified}`, file)
    if (merged.size > 8) { setError('Selecione no máximo 8 ficheiros de evidência.'); return }
    setFiles([...merged.values()]); setError('')
  }

  async function resolveSelected() {
    if (!selectedEvents.size) return
    try {
      const next = await api.resolveEvolutionEvidence(session.id, [...selectedEvents])
      setEvidence(next); setSelectedEvents(new Set())
    } catch (cause) { setError(String(cause instanceof Error ? cause.message : cause)) }
  }

  async function analyze() {
    const refs = (evidence?.knowledge || []).filter((entry) => selectedKnowledge.has(knowledgeKey(entry.project_path, entry.id)))
      .map(({ project_path, id }) => ({ project_path, id }))
    const knowledgeOnlyReview = knowledgeOnly && selectedEvents.size === 0 && refs.length > 0
    await onAnalyze([...selectedEvents], refs, files, knowledgeOnlyReview)
  }

  return <section className="@container/evidence flex h-full min-h-0 flex-col bg-whx-surface text-whx-text" aria-label="Evidência de auto-evolução">
    <EvidenceHeader evidence={evidence} onClose={onClose}/>

    <div className="border-b border-whx-border-soft bg-whx-surface px-3 py-2">
      <EvolutionEvidenceTabs value={source} onChange={switchSource} events={evidence?.events.length ?? 0} knowledge={evidence?.knowledge.length ?? 0} files={files.length}/>
      {source !== 'external' && <div>
        <EvidenceFilters project={project} category={category} query={query} projects={evidence?.projects || []} categories={categories} categoryLabel={(value) => source === 'knowledge' ? knowledgeCategoryLabel[value] || value : value} placeholder={source === 'events' ? 'Pesquisar eventos…' : 'Pesquisar conhecimento…'} allSelected={allSelected} onProject={setProject} onCategory={setCategory} onQuery={setQuery} onToggleAll={toggleAll}/>
        {source === 'knowledge' && selectedKnowledge.size > 0 && selectedEvents.size === 0 && <label className="col-span-2 flex cursor-pointer items-start gap-2 rounded-lg border border-whx-border bg-whx-elevated px-3 py-2 text-whx-soft">
          <input className="mt-1" type="checkbox" aria-label="Analisar apenas conhecimento selecionado" checked={knowledgeOnly} onChange={(event) => setKnowledgeOnly(event.target.checked)}/>
          <span><strong className="block text-base text-whx-text">Só conhecimento</strong><small className="block text-sm leading-5 text-whx-faint">Sem esta opção, o Wharnex inclui uma amostra limitada de eventos operacionais recentes de alto sinal.</small></span>
        </label>}
      </div>}
    </div>

    {error && <p className="m-0 border-b border-whx-danger/30 bg-whx-danger/10 px-3 py-2 text-base text-whx-danger">{error}</p>}

    <div className="min-h-0 flex-1 overflow-auto p-3">
      {source === 'events' && <EvolutionEventsList events={visibleEvents} selected={selectedEvents} onToggle={toggleEvent} total={filteredEvents.length} onShowMore={showMore}/>}
      {source === 'knowledge' && <div className="grid gap-1.5">{visibleKnowledge.map((entry) => {
        const key = knowledgeKey(entry.project_path, entry.id)
        return <article className={`[content-visibility:auto] [contain-intrinsic-size:auto_108px] rounded-lg border px-3 py-2.5 transition ${selectedKnowledge.has(key) ? 'border-whx-accent bg-whx-accent-soft shadow-sm' : 'border-whx-border bg-whx-elevated hover:border-whx-soft'}`} key={key}>
          <label className="grid cursor-pointer grid-cols-[auto_1fr] gap-2.5"><input className="mt-1" type="checkbox" aria-label={`Selecionar conhecimento ${entry.id}`} checked={selectedKnowledge.has(key)} onChange={() => setSelectedKnowledge((current) => toggleSet(current, key))}/><span className="min-w-0"><span className="flex flex-wrap items-center gap-1.5"><strong className="truncate text-base">{entry.id}</strong><i className="rounded-full bg-whx-muted px-1.5 py-0.5 text-xs font-semibold not-italic uppercase tracking-wide text-whx-soft">{knowledgeCategoryLabel[entry.category] || entry.category}</i><span className="text-xs text-whx-faint">v{entry.version}</span></span><small className="mt-1 block truncate text-sm text-whx-faint">{entry.project_name || entry.project_path}</small><p className="mb-0 mt-1.5 text-base leading-5 text-whx-soft">{entry.excerpt}</p></span></label>
        </article>
      })}{filteredKnowledge.length > 0 && <EvidenceListPager shown={visibleKnowledge.length} total={filteredKnowledge.length} label="conhecimentos" onShowMore={showMore}/>}</div>}
      {source === 'external' && <ExternalEvidence files={files} busy={busy} uploadRef={uploadRef} addFiles={addFiles} removeFile={(file) => setFiles((current) => current.filter((candidate) => candidate !== file))}/>}
      {source === 'events' && !filteredEvents.length && <EmptyState icon="activity" text="Nenhum evento corresponde aos filtros."/>}
      {source === 'knowledge' && !filteredKnowledge.length && <EmptyState icon="knowledge" text="Nenhum conhecimento elegível corresponde aos filtros."/>}
    </div>

    <footer className="flex items-center justify-between gap-2 border-t border-whx-border bg-whx-raised px-3 py-2">
      <span className="text-whx-label text-whx-faint">{dossierCount} pronto{dossierCount === 1 ? '' : 's'}</span>
      <div className="flex flex-wrap justify-end gap-2">
        {source === 'events' && selectedEvents.size > 0 && <Button icon="check" disabled={busy} onClick={() => void resolveSelected()}>Marcar tratados</Button>}
        <Button tone="primary" icon="sparkles" disabled={busy || !dossierCount} onClick={() => void analyze()}>Analisar e evoluir</Button>
      </div>
    </footer>
  </section>
}

function ExternalEvidence({ files, busy, uploadRef, addFiles, removeFile }: { files: File[]; busy: boolean; uploadRef: RefObject<HTMLInputElement | null>; addFiles: (files: FileList | null) => void; removeFile: (file: File) => void }) {
  return <div className="grid gap-2">
    <div className="grid place-items-center gap-2 rounded-xl border border-dashed border-whx-border bg-whx-elevated px-4 py-8 text-center" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files) }}>
      <span className="grid size-10 place-items-center rounded-xl bg-whx-accent-soft text-whx-accent"><Icon name="file" size={19}/></span>
      <div><strong className="block text-lg">Importar logs externos</strong><span className="mt-1 block text-sm text-whx-faint">Chats · planos · execuções exportadas</span></div>
      <button type="button" className="rounded-lg border border-whx-border bg-whx-surface px-3 py-2 text-base font-semibold hover:bg-whx-hover disabled:opacity-50" onClick={() => uploadRef.current?.click()} disabled={busy} title="ZIP, JSON, Markdown, LOG ou TXT"><Icon name="plus" size={12}/> Escolher ficheiros</button>
      <input ref={uploadRef} className="hidden" type="file" multiple aria-label="Carregar logs externos" accept=".zip,.md,.json,.log,.txt" onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = '' }}/>
    </div>
    {files.map((file) => <div key={`${file.name}:${file.lastModified}`} className="flex items-center gap-2 rounded-lg border border-whx-border bg-whx-elevated px-3 py-2"><span className="grid size-7 shrink-0 place-items-center rounded-md bg-whx-muted text-whx-soft"><Icon name="file" size={13}/></span><span className="min-w-0 flex-1"><strong className="block truncate text-base">{file.name}</strong><small className="text-sm text-whx-faint">{formatBytes(file.size)}</small></span><button type="button" className="rounded-md p-1.5 text-whx-faint hover:bg-whx-hover hover:text-whx-text" onClick={() => removeFile(file)} aria-label={`Remover ${file.name}`}><Icon name="close" size={11}/></button></div>)}
  </div>
}

function EmptyState({ icon, text }: { icon: Parameters<typeof Icon>[0]['name']; text: string }) {
  return <div className="flex items-center gap-2 px-2 py-4 text-whx-label text-whx-faint"><Icon name={icon} size={18}/><span>{text}</span></div>
}

function toggleSet(current: Set<string>, id: string) { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next }
function formatBytes(bytes: number) { return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB` }
