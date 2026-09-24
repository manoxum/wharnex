import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { api } from '../lib/api'
import type { EvolutionEvidence, EvolutionKnowledgeRef, Session } from '../types'
import { Icon } from './Icon'

type Props = {
  session: Session
  busy: boolean
  onAnalyze: (ids: string[], knowledgeRefs?: EvolutionKnowledgeRef[], files?: File[]) => Promise<void>
  onClose: () => void
}

type Source = 'events' | 'knowledge' | 'external'

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
      (!term || `${event.type}\n${event.project_name || event.project_path}\n${JSON.stringify(event.data)}`.toLocaleLowerCase().includes(term)))
  }, [evidence, project, category, query])

  const filteredKnowledge = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    return (evidence?.knowledge || []).filter((entry) => (!project || entry.project_path === project) && (!category || entry.category === category) &&
      (!term || `${entry.id}\n${entry.excerpt}\n${entry.project_name || entry.project_path}`.toLocaleLowerCase().includes(term)))
  }, [evidence, project, category, query])

  const categories = source === 'events' ? evidence?.categories || [] : source === 'knowledge' ? evidence?.knowledge_categories || [] : []
  const selectedCount = selectedEvents.size + selectedKnowledge.size
  const dossierCount = selectedCount + files.length
  const visibleKeys = source === 'events' ? filteredEvents.map((event) => event.id) :
    source === 'knowledge' ? filteredKnowledge.map((entry) => knowledgeKey(entry.project_path, entry.id)) : []
  const allSelected = visibleKeys.length > 0 && visibleKeys.every((id) => source === 'events' ? selectedEvents.has(id) : selectedKnowledge.has(id))

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
    await onAnalyze([...selectedEvents], refs, files)
  }

  return <section className="flex h-full min-h-0 flex-col bg-whx-surface text-whx-text" aria-label="Evidência de auto-evolução">
    <header className="border-b border-whx-border bg-whx-elevated px-4 pb-3 pt-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="block font-mono text-sm font-bold uppercase tracking-[.18em] text-whx-accent">WHX · AUTO-EVOLUÇÃO</span>
          <strong className="mt-1 block text-xl">Dossiê de evolução</strong>
          <p className="mb-0 mt-1 text-base text-whx-faint">Escolha uma fonte, selecione sinais e evolua.</p>
        </div>
        <button type="button" className="rounded-lg border border-whx-border bg-whx-surface p-2 text-whx-soft transition hover:bg-whx-hover hover:text-whx-text" onClick={onClose} aria-label="Fechar evidência"><Icon name="close" size={14}/></button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Metric value={evidence?.total ?? '—'} label="eventos" detail={evidence?.truncated ? 'limitados' : 'não tratados'}/>
        <Metric value={evidence?.knowledge_total ?? '—'} label="conhecimento" detail={evidence?.knowledge_truncated ? 'limitado' : 'elegível'}/>
        <Metric value={dossierCount} label="prontos" detail={files.length ? `${files.length} externos` : 'dossiê atual'} accent/>
      </div>
    </header>

    <div className="border-b border-whx-border bg-whx-surface px-3 py-3">
      <div className="grid grid-cols-3 gap-1.5" role="tablist" aria-label="Modalidade de auto-evolução">
        <ModeTab source="events" active={source} icon="activity" label="Eventos" count={evidence?.events.length ?? 0} onSelect={switchSource}/>
        <ModeTab source="knowledge" active={source} icon="knowledge" label="Conhecimento" count={evidence?.knowledge.length ?? 0} onSelect={switchSource}/>
        <ModeTab source="external" active={source} icon="file" label="Logs externos" count={files.length} onSelect={switchSource}/>
      </div>
      {source !== 'external' && <div className="mt-2 grid grid-cols-2 gap-2">
        <select aria-label="Filtrar projeto" className="min-w-0 rounded-lg border border-whx-border bg-whx-elevated px-2 py-2 text-base outline-none focus:border-whx-accent" value={project} onChange={(event) => setProject(event.target.value)}><option value="">Todos os projetos</option>{evidence?.projects.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <select aria-label="Filtrar categoria" className="min-w-0 rounded-lg border border-whx-border bg-whx-elevated px-2 py-2 text-base outline-none focus:border-whx-accent" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Todas as categorias</option>{categories.map((value) => <option key={value} value={value}>{source === 'knowledge' ? knowledgeCategoryLabel[value] || value : value}</option>)}</select>
        <label className="col-span-2 flex items-center gap-2 rounded-lg border border-whx-border bg-whx-elevated px-3 py-2 text-whx-faint focus-within:border-whx-accent focus-within:text-whx-soft"><Icon name="search" size={13}/><input aria-label="Pesquisar evidência" className="min-w-0 flex-1 bg-transparent text-base text-whx-text outline-none" placeholder={source === 'events' ? 'Pesquisar eventos…' : 'Pesquisar conhecimento…'} value={query} onChange={(event) => setQuery(event.target.value)}/>{query && <button type="button" className="text-whx-faint hover:text-whx-text" onClick={() => setQuery('')} aria-label="Limpar pesquisa"><Icon name="close" size={11}/></button>}</label>
        <button type="button" className="col-span-2 justify-self-start rounded-md px-1 py-1 text-sm font-semibold text-whx-soft hover:text-whx-text" onClick={toggleAll}>{allSelected ? 'Desmarcar visíveis' : 'Selecionar visíveis'}</button>
      </div>}
    </div>

    {error && <p className="m-0 border-b border-whx-danger/30 bg-whx-danger/10 px-3 py-2 text-base text-whx-danger">{error}</p>}

    <div className="min-h-0 flex-1 overflow-auto p-3">
      {source === 'events' && <div className="grid gap-1.5">{filteredEvents.slice().reverse().map((event) => <article className={`rounded-lg border px-3 py-2.5 transition ${selectedEvents.has(event.id) ? 'border-whx-accent bg-whx-accent-soft shadow-sm' : 'border-whx-border bg-whx-elevated hover:border-whx-soft'}`} key={event.id}>
        <label className="grid cursor-pointer grid-cols-[auto_1fr_auto] items-start gap-2.5"><input className="mt-1" type="checkbox" aria-label={`Selecionar evento ${event.type}`} checked={selectedEvents.has(event.id)} onChange={() => setSelectedEvents((current) => toggleSet(current, event.id))}/><span className="min-w-0"><span className="flex min-w-0 items-center gap-1.5"><i className="rounded-full bg-whx-muted px-1.5 py-0.5 text-xs font-semibold not-italic uppercase tracking-wide text-whx-soft">{event.category}</i><code className="truncate text-sm text-whx-text">{event.type}</code></span><small className="mt-1 block truncate text-sm text-whx-faint">{event.project_name || event.project_path}</small></span><time className="text-right text-xs leading-4 text-whx-faint">{new Date(event.timestamp).toLocaleDateString()}<br/>{new Date(event.timestamp).toLocaleTimeString()}</time></label>
        <details className="mt-1.5 text-sm text-whx-faint"><summary className="cursor-pointer select-none hover:text-whx-text">Dados</summary><pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-whx-border bg-whx-muted p-2 text-xs whitespace-pre-wrap">{JSON.stringify(event.data, null, 2)}</pre></details>
      </article>)}</div>}
      {source === 'knowledge' && <div className="grid gap-1.5">{filteredKnowledge.slice().reverse().map((entry) => {
        const key = knowledgeKey(entry.project_path, entry.id)
        return <article className={`rounded-lg border px-3 py-2.5 transition ${selectedKnowledge.has(key) ? 'border-whx-accent bg-whx-accent-soft shadow-sm' : 'border-whx-border bg-whx-elevated hover:border-whx-soft'}`} key={key}>
          <label className="grid cursor-pointer grid-cols-[auto_1fr] gap-2.5"><input className="mt-1" type="checkbox" aria-label={`Selecionar conhecimento ${entry.id}`} checked={selectedKnowledge.has(key)} onChange={() => setSelectedKnowledge((current) => toggleSet(current, key))}/><span className="min-w-0"><span className="flex flex-wrap items-center gap-1.5"><strong className="truncate text-base">{entry.id}</strong><i className="rounded-full bg-whx-muted px-1.5 py-0.5 text-xs font-semibold not-italic uppercase tracking-wide text-whx-soft">{knowledgeCategoryLabel[entry.category] || entry.category}</i><span className="text-xs text-whx-faint">v{entry.version}</span></span><small className="mt-1 block truncate text-sm text-whx-faint">{entry.project_name || entry.project_path}</small><p className="mb-0 mt-1.5 text-base leading-5 text-whx-soft">{entry.excerpt}</p></span></label>
        </article>
      })}</div>}
      {source === 'external' && <ExternalEvidence files={files} busy={busy} uploadRef={uploadRef} addFiles={addFiles} removeFile={(file) => setFiles((current) => current.filter((candidate) => candidate !== file))}/>}
      {source === 'events' && !filteredEvents.length && <EmptyState icon="activity" text="Nenhum evento corresponde aos filtros."/>}
      {source === 'knowledge' && !filteredKnowledge.length && <EmptyState icon="knowledge" text="Nenhum conhecimento elegível corresponde aos filtros."/>}
    </div>

    <footer className="flex items-center justify-between gap-2 border-t border-whx-border bg-whx-elevated p-3">
      <span className={`rounded-full border px-2 py-1 text-sm font-semibold ${dossierCount ? 'border-whx-accent/50 bg-whx-accent-soft text-whx-accent' : 'border-whx-border bg-whx-muted text-whx-faint'}`}>{dossierCount} pronto{dossierCount === 1 ? '' : 's'}</span>
      <div className="flex flex-wrap justify-end gap-2">
        {source === 'events' && selectedEvents.size > 0 && <button type="button" className="rounded-lg border border-whx-border bg-whx-surface px-3 py-2 text-base font-semibold text-whx-soft hover:bg-whx-hover hover:text-whx-text disabled:opacity-50" disabled={busy} onClick={() => void resolveSelected()}><Icon name="check" size={12}/> Marcar tratados</button>}
        <button type="button" className="rounded-lg bg-whx-accent px-3 py-2 text-base font-bold text-whx-bg shadow-sm transition hover:brightness-105 disabled:opacity-50" disabled={busy || !dossierCount} onClick={() => void analyze()}><Icon name="sparkles" size={13}/> Analisar e evoluir</button>
      </div>
    </footer>
  </section>
}

function ModeTab({ source, active, icon, label, count, onSelect }: { source: Source; active: Source; icon: Parameters<typeof Icon>[0]['name']; label: string; count: number; onSelect: (source: Source) => void }) {
  const selected = source === active
  return <button type="button" role="tab" aria-selected={selected} className={`flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition ${selected ? 'border-whx-accent/60 bg-whx-accent-soft text-whx-text shadow-sm' : 'border-whx-border bg-whx-elevated text-whx-soft hover:border-whx-soft hover:text-whx-text'}`} onClick={() => onSelect(source)}><span className={`grid size-7 shrink-0 place-items-center rounded-md ${selected ? 'bg-whx-accent text-whx-bg' : 'bg-whx-muted text-whx-faint'}`}><Icon name={icon} size={13}/></span><span className="min-w-0 flex-1 truncate text-base font-semibold">{label}</span><span className="rounded-full bg-whx-muted px-1.5 py-0.5 text-xs text-whx-faint">{count}</span></button>
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

function Metric({ value, label, detail, accent = false }: { value: string | number; label: string; detail: string; accent?: boolean }) {
  return <span className={`inline-flex items-baseline gap-1.5 rounded-full border px-2.5 py-1 ${accent ? 'border-whx-accent/50 bg-whx-accent-soft text-whx-accent' : 'border-whx-border bg-whx-surface'}`}><b className="text-base">{value}</b><span className="text-sm font-semibold text-whx-soft">{label}</span><small className="text-xs text-whx-faint">{detail}</small></span>
}

function EmptyState({ icon, text }: { icon: Parameters<typeof Icon>[0]['name']; text: string }) {
  return <div className="grid place-items-center gap-2 rounded-xl border border-dashed border-whx-border bg-whx-muted px-4 py-10 text-center text-base text-whx-faint"><Icon name={icon} size={18}/><span>{text}</span></div>
}

function toggleSet(current: Set<string>, id: string) { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next }
function formatBytes(bytes: number) { return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB` }
