import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { EvolutionEvidence, EvolutionKnowledgeRef, Session } from '../types'
import { Icon } from './Icon'

type Props = {
  session: Session
  busy: boolean
  onAnalyze: (ids: string[], knowledgeRefs?: EvolutionKnowledgeRef[], files?: File[]) => Promise<void>
  onClose: () => void
}

type Source = 'events' | 'knowledge'

const knowledgeCategoryLabel: Record<string, string> = {
  conflict_resolution: 'Conflitos',
  patch_strategy: 'Patches',
  execution_repair: 'Reparação',
  verification: 'Verificação',
  runtime_environment: 'Runtime',
  protocol_transport: 'Protocolo',
  product_domain: 'Domínio',
  general: 'Geral',
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
    return (evidence?.events || []).filter((event) =>
      (!project || event.project_path === project) &&
      (!category || event.category === category) &&
      (!term || `${event.type}\n${event.project_name || event.project_path}\n${JSON.stringify(event.data)}`.toLocaleLowerCase().includes(term)),
    )
  }, [evidence, project, category, query])

  const filteredKnowledge = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    return (evidence?.knowledge || []).filter((entry) =>
      (!project || entry.project_path === project) &&
      (!category || entry.category === category) &&
      (!term || `${entry.id}\n${entry.excerpt}\n${entry.project_name || entry.project_path}`.toLocaleLowerCase().includes(term)),
    )
  }, [evidence, project, category, query])

  const categories = source === 'events' ? evidence?.categories || [] : evidence?.knowledge_categories || []
  const selectedCount = selectedEvents.size + selectedKnowledge.size
  const hasInput = selectedCount > 0 || files.length > 0
  const visibleKeys = source === 'events'
    ? filteredEvents.map((event) => event.id)
    : filteredKnowledge.map((entry) => knowledgeKey(entry.project_path, entry.id))
  const allSelected = visibleKeys.length > 0 && visibleKeys.every((id) => source === 'events' ? selectedEvents.has(id) : selectedKnowledge.has(id))

  function switchSource(next: Source) {
    setSource(next); setCategory(''); setQuery('')
  }

  function toggleAll() {
    if (source === 'events') {
      setSelectedEvents((current) => {
        const next = new Set(current)
        for (const id of visibleKeys) { if (allSelected) next.delete(id); else next.add(id) }
        return next
      })
      return
    }
    setSelectedKnowledge((current) => {
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
    const refs: EvolutionKnowledgeRef[] = []
    for (const entry of evidence?.knowledge || []) {
      if (selectedKnowledge.has(knowledgeKey(entry.project_path, entry.id))) refs.push({ project_path: entry.project_path, id: entry.id })
    }
    await onAnalyze([...selectedEvents], refs, files)
  }

  return <section className="flex h-full min-h-0 flex-col bg-whx-surface text-whx-text" aria-label="Evidência de auto-evolução">
    <header className="border-b border-whx-border bg-whx-elevated px-4 pb-3 pt-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="block font-mono text-[10px] font-bold uppercase tracking-[.18em] text-whx-accent">WHX · AUTO-EVOLUÇÃO</span>
          <strong className="mt-1 block text-base">Dossiê de melhoria contínua</strong>
          <p className="mt-1 max-w-[42rem] text-[11px] leading-5 text-whx-faint">Combine eventos operacionais, conhecimento reutilizável e ficheiros externos. Apenas categorias de conhecimento operacional entram como evidência de auto-evolução.</p>
        </div>
        <button type="button" className="rounded-md border border-whx-border bg-whx-surface p-1.5 text-whx-soft hover:bg-whx-hover hover:text-whx-text" onClick={onClose} aria-label="Fechar evidência"><Icon name="close" size={13}/></button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Metric value={evidence?.total ?? '—'} label="eventos" detail={evidence?.truncated ? 'lista limitada' : 'não tratados'}/>
        <Metric value={evidence?.knowledge_total ?? '—'} label="conhecimentos" detail={evidence?.knowledge_truncated ? 'lista limitada' : 'elegíveis'}/>
        <Metric value={selectedCount + files.length} label="no dossiê" detail={`${files.length} ficheiro${files.length === 1 ? '' : 's'}`} accent/>
      </div>
    </header>

    <div className="border-b border-whx-border px-3 py-3">
      <div className="grid grid-cols-2 rounded-lg border border-whx-border bg-whx-muted p-1" role="tablist" aria-label="Fonte de evidência">
        <button type="button" role="tab" aria-selected={source === 'events'} className={`rounded-md px-3 py-2 text-xs font-semibold transition ${source === 'events' ? 'bg-whx-elevated text-whx-text shadow-sm' : 'text-whx-soft hover:text-whx-text'}`} onClick={() => switchSource('events')}><Icon name="activity" size={12}/> Eventos <span className="ml-1 text-[10px] text-whx-faint">{evidence?.events.length ?? 0}</span></button>
        <button type="button" role="tab" aria-selected={source === 'knowledge'} className={`rounded-md px-3 py-2 text-xs font-semibold transition ${source === 'knowledge' ? 'bg-whx-elevated text-whx-text shadow-sm' : 'text-whx-soft hover:text-whx-text'}`} onClick={() => switchSource('knowledge')}><Icon name="knowledge" size={12}/> Conhecimento <span className="ml-1 text-[10px] text-whx-faint">{evidence?.knowledge.length ?? 0}</span></button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <select aria-label="Filtrar projeto" className="min-w-0 rounded-md border border-whx-border bg-whx-elevated px-2 py-2 text-xs" value={project} onChange={(event) => setProject(event.target.value)}><option value="">Todos os projetos</option>{evidence?.projects.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <select aria-label="Filtrar categoria" className="min-w-0 rounded-md border border-whx-border bg-whx-elevated px-2 py-2 text-xs" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Todas as categorias</option>{categories.map((value) => <option key={value} value={value}>{source === 'knowledge' ? knowledgeCategoryLabel[value] || value : value}</option>)}</select>
        <label className="col-span-2 flex items-center gap-2 rounded-md border border-whx-border bg-whx-elevated px-2 py-1.5"><Icon name="search" size={12}/><input aria-label="Pesquisar evidência" className="min-w-0 flex-1 bg-transparent text-xs outline-none" placeholder={source === 'events' ? 'Pesquisar tipo, projeto ou dados…' : 'Pesquisar conhecimento…'} value={query} onChange={(event) => setQuery(event.target.value)}/>{query && <button type="button" className="text-whx-faint hover:text-whx-text" onClick={() => setQuery('')} aria-label="Limpar pesquisa"><Icon name="close" size={10}/></button>}</label>
      </div>
      <button type="button" className="mt-2 text-left text-[11px] font-medium text-whx-soft hover:text-whx-text" onClick={toggleAll}>{allSelected ? 'Desmarcar itens visíveis' : 'Selecionar itens visíveis'}</button>
    </div>

    {error && <p className="m-0 border-b border-whx-danger/30 bg-whx-danger/10 px-3 py-2 text-xs text-whx-danger">{error}</p>}

    <div className="min-h-0 flex-1 overflow-auto p-3">
      {source === 'events' ? <div className="grid gap-2">{filteredEvents.slice().reverse().map((event) => <article className={`rounded-xl border p-3 transition ${selectedEvents.has(event.id) ? 'border-whx-accent bg-whx-accent-soft shadow-sm' : 'border-whx-border bg-whx-elevated hover:border-whx-soft'}`} key={event.id}>
        <label className="grid cursor-pointer grid-cols-[auto_1fr_auto] gap-2.5"><input className="mt-0.5" type="checkbox" checked={selectedEvents.has(event.id)} onChange={() => setSelectedEvents((current) => { const next = new Set(current); if (next.has(event.id)) next.delete(event.id); else next.add(event.id); return next })}/><span className="min-w-0"><span className="flex min-w-0 items-center gap-1.5"><i className="rounded-full bg-whx-muted px-1.5 py-0.5 text-[9px] font-semibold not-italic uppercase tracking-wide text-whx-soft">{event.category}</i><code className="truncate text-[10px] text-whx-text">{event.type}</code></span><small className="mt-1 block truncate text-[10px] text-whx-faint">{event.project_name || event.project_path}</small></span><time className="text-right text-[9px] leading-4 text-whx-faint">{new Date(event.timestamp).toLocaleDateString()}<br/>{new Date(event.timestamp).toLocaleTimeString()}</time></label>
        <details className="mt-2 text-xs text-whx-faint"><summary className="cursor-pointer select-none hover:text-whx-text">Inspecionar dados</summary><pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-whx-border bg-whx-muted p-2 text-[10px] whitespace-pre-wrap">{JSON.stringify(event.data, null, 2)}</pre></details>
      </article>)}</div> : <div className="grid gap-2">{filteredKnowledge.slice().reverse().map((entry) => {
        const key = knowledgeKey(entry.project_path, entry.id)
        return <article className={`rounded-xl border p-3 transition ${selectedKnowledge.has(key) ? 'border-whx-accent bg-whx-accent-soft shadow-sm' : 'border-whx-border bg-whx-elevated hover:border-whx-soft'}`} key={key}>
          <label className="grid cursor-pointer grid-cols-[auto_1fr] gap-2.5"><input className="mt-0.5" type="checkbox" checked={selectedKnowledge.has(key)} onChange={() => setSelectedKnowledge((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next })}/><span className="min-w-0"><span className="flex flex-wrap items-center gap-1.5"><strong className="truncate text-xs">{entry.id}</strong><i className="rounded-full bg-whx-muted px-1.5 py-0.5 text-[9px] font-semibold not-italic uppercase tracking-wide text-whx-soft">{knowledgeCategoryLabel[entry.category] || entry.category}</i><span className="text-[9px] text-whx-faint">v{entry.version}</span></span><small className="mt-1 block truncate text-[10px] text-whx-faint">{entry.project_name || entry.project_path}</small><p className="mb-0 mt-2 text-[11px] leading-5 text-whx-soft">{entry.excerpt}</p></span></label>
        </article>
      })}</div>}
      {source === 'events' && !filteredEvents.length && <EmptyState icon="activity" text="Nenhum evento corresponde aos filtros atuais."/>}
      {source === 'knowledge' && !filteredKnowledge.length && <EmptyState icon="knowledge" text="Nenhum conhecimento operacional elegível corresponde aos filtros atuais."/>}
    </div>

    <div className="border-t border-whx-border bg-whx-muted p-3">
      <div className="mb-2 flex items-center justify-between gap-2"><div><span className="block text-[11px] font-semibold">Evidência externa</span><span className="text-[10px] text-whx-faint">Logs, Markdown, JSON ou ZIP · somente leitura</span></div><button type="button" className="rounded-md border border-whx-border bg-whx-elevated px-2 py-1.5 text-[11px] font-medium hover:bg-whx-hover" onClick={() => uploadRef.current?.click()} disabled={busy}><Icon name="plus" size={11}/> Adicionar</button><input ref={uploadRef} className="hidden" type="file" multiple accept=".zip,.md,.json,.log,.txt" onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = '' }}/></div>
      {files.length > 0 && <div className="mb-2 flex flex-wrap gap-1.5">{files.map((file) => <button key={`${file.name}:${file.lastModified}`} type="button" className="rounded-full border border-whx-border bg-whx-elevated px-2 py-1 text-[10px] text-whx-soft hover:text-whx-text" onClick={() => setFiles((current) => current.filter((candidate) => candidate !== file))}>{file.name} ×</button>)}</div>}
      <div className="flex flex-wrap gap-2"><button type="button" className="rounded-md bg-whx-accent px-3 py-2 text-xs font-semibold text-whx-bg disabled:opacity-50" disabled={busy || !hasInput} onClick={() => void analyze()}><Icon name="agent" size={13}/> Analisar e evoluir</button><button type="button" className="rounded-md border border-whx-border bg-whx-elevated px-3 py-2 text-xs disabled:opacity-50" disabled={busy || !selectedEvents.size} onClick={() => void resolveSelected()}><Icon name="check" size={12}/> Marcar eventos tratados</button></div>
    </div>
  </section>
}

function Metric({ value, label, detail, accent = false }: { value: string | number; label: string; detail: string; accent?: boolean }) {
  return <div className={`rounded-lg border px-3 py-2 ${accent ? 'border-whx-accent/50 bg-whx-accent-soft text-whx-accent' : 'border-whx-border bg-whx-surface'}`}><b className="block text-lg leading-none">{value}</b><span className="mt-1 block text-[9px] font-semibold uppercase tracking-[.12em] text-whx-faint">{label}</span><small className="mt-0.5 block text-[9px] text-whx-faint">{detail}</small></div>
}

function EmptyState({ icon, text }: { icon: Parameters<typeof Icon>[0]['name']; text: string }) {
  return <div className="grid place-items-center gap-2 rounded-xl border border-dashed border-whx-border bg-whx-muted px-4 py-10 text-center text-xs text-whx-faint"><Icon name={icon} size={18}/><span>{text}</span></div>
}
