import { translate as uiText, interfaceLocale, formatMessage } from '../../../lib/workspace/localization'
import { Button, IconButton, PanelHeader, EmptyState, Select } from '../../presentation/workbench'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../../lib/transport/http/api'
import { knowledgeConsolidationPending } from '../../../lib/agent/runtime/requestActivity'
import type { KnowledgeCategory, ProjectKnowledgeCatalog, Session } from '../../../types'
import { Icon } from '../../presentation/chrome/Icon'
import { ContentSkeleton } from '../../presentation/chrome/Skeleton'
import { TranslatableMarkdown } from '../../presentation/content/TranslatableMarkdown'

const categoryLabel: Record<KnowledgeCategory, string> = {
  conflict_resolution: 'Conflitos',
  patch_strategy: 'Estratégia de patch',
  execution_repair: 'Reparação',
  verification: 'Verificação',
  runtime_environment: 'Runtime',
  protocol_transport: 'Protocolo e transporte',
  product_domain: 'Domínio do projeto',
  general: 'Geral',
}

const selfEvolutionCategories = new Set<KnowledgeCategory>(['conflict_resolution', 'patch_strategy', 'execution_repair', 'verification', 'runtime_environment', 'protocol_transport'])

export function ProjectKnowledgeDrawer({ session, busy = false, onConsolidate, onClose }: { session: Session; busy?: boolean; onConsolidate?: () => Promise<void>; onClose: () => void }) {
  const [catalog, setCatalog] = useState<ProjectKnowledgeCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [consolidating, setConsolidating] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<KnowledgeCategory | ''>('')
  const [selected, setSelected] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const result = await api.projectKnowledgeCatalog(session.id)
      setCatalog(result.catalog)
      setSelected((current) => current && result.catalog.entries.some((entry) => entry.id === current) ? current : result.catalog.entries[0]?.id || '')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : uiText('Não foi possível carregar os conhecimentos do projeto.'))
    } finally { setLoading(false) }
  }, [session.id])

  useEffect(() => { void refresh() }, [refresh, session.last_turn?.request_id, session.knowledge_last_seen_revision])

  const categories = useMemo(() => Array.from(new Set((catalog?.entries || []).map((entry) => entry.category || 'general'))).sort(), [catalog])
  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    return (catalog?.entries || []).filter((entry) => {
      const currentCategory = entry.category || 'general'
      return (!category || currentCategory === category) && (!term || `${entry.id}\n${entry.content}`.toLocaleLowerCase().includes(term))
    })
  }, [catalog, category, query])
  const selectedEntry = visible.find((entry) => entry.id === selected) || visible[0]
  const operationalCount = (catalog?.entries || []).filter((entry) => selfEvolutionCategories.has(entry.category || 'general')).length
  const consolidationInFlight = knowledgeConsolidationPending(session)

  async function consolidate() {
    if (!onConsolidate || consolidating || busy || consolidationInFlight || (catalog?.entries.length || 0) < 2) return
    setConsolidating(true); setError('')
    try { await onConsolidate() } catch (cause) { setError(cause instanceof Error ? cause.message : uiText('Não foi possível iniciar a consolidação.')) } finally { setConsolidating(false) }
  }

  return <section className="project-knowledge-drawer @container flex h-full min-h-0 flex-col bg-whx-bg text-whx-text" aria-label={uiText("Conhecimento do projeto")}>
    <PanelHeader title={uiText("Conhecimento do projeto")} icon="knowledge" actions={<><IconButton label={uiText("Atualizar conhecimentos")} icon="refresh" disabled={loading} onClick={() => void refresh()}/><IconButton label={uiText("Fechar conhecimentos")} icon="close" onClick={onClose}/></>}/>

    {catalog && <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-whx-border-soft bg-whx-surface px-3 py-2 @max-[520px]:gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-whx-border-soft bg-whx-muted px-2 font-mono text-whx-support text-whx-soft"><Icon name="knowledge" size={13}/>r{catalog.revision}</span>
        <span className="inline-flex min-h-7 items-center rounded-md border border-whx-border-soft bg-whx-muted px-2 text-whx-support text-whx-soft">{formatMessage(catalog.entries.length === 1 ? "{count} registo" : "{count} registos", { count: catalog.entries.length })}</span>
        <span className="inline-flex min-h-7 items-center rounded-md border border-whx-border-soft bg-whx-muted px-2 text-whx-support text-whx-soft">{operationalCount} {' '}{uiText("para auto-evolução")}</span>
      </div>
      <div className="flex min-w-0 flex-[1_1_420px] flex-wrap items-center justify-end gap-2 @max-[520px]:justify-start">
        <label className="panel-search-field min-w-[190px] max-w-full flex-1"><Icon name="search" size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={uiText("Pesquisar conhecimentos")} aria-label={uiText("Pesquisar conhecimentos")}/>{query && <button type="button" onClick={() => setQuery('')} aria-label="Limpar pesquisa"><Icon name="close" size={12}/></button>}</label>
        <Select aria-label={uiText("Filtrar categoria de conhecimento")} className="!max-w-full !px-2.5" value={category} onChange={(event) => setCategory(event.target.value as KnowledgeCategory | '')}><option value="">{uiText("Todas as categorias")}</option>{categories.map((value) => <option key={value} value={value}>{uiText(categoryLabel[value as KnowledgeCategory] || value)}</option>)}</Select>
        {onConsolidate && <Button tone="neutral" icon="sparkles" className="!whitespace-nowrap !px-2.5" disabled={busy || consolidating || consolidationInFlight || catalog.entries.length < 2} onClick={() => void consolidate()} title={consolidationInFlight ? uiText("A consolidação deste catálogo já está em curso neste chat") : uiText("Enviar o catálogo completo ao GPT para deduplicar, reconciliar e reorganizar")}>{consolidationInFlight ? uiText("Consolidação em curso") : consolidating ? uiText("A preparar…") : uiText("Consolidar com GPT")}</Button>}
      </div>
    </div>}
    {loading && !catalog ? <ContentSkeleton label={uiText("A carregar conhecimentos adquiridos")} rows={5}/> : error && !catalog ? <div className="agent-drawer-empty">{error}</div> : !catalog || !catalog.entries.length ? <EmptyState icon="knowledge" title={uiText("Sem conhecimentos")} compact action={<Button icon="refresh" onClick={() => void refresh()}>{uiText("Atualizar conhecimentos")}</Button>}/> : <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(190px,min(28%,320px))_minmax(0,1fr)] border-t border-whx-border @max-[520px]:grid-cols-1 @max-[520px]:grid-rows-[minmax(100px,auto)_minmax(240px,1fr)] max-[820px]:grid-cols-1 max-[820px]:grid-rows-[minmax(100px,auto)_minmax(240px,1fr)]">
      <nav className="min-h-0 min-w-0 overflow-auto border-r border-whx-border-soft bg-whx-surface p-2 @max-[520px]:max-h-[180px] @max-[520px]:border-b @max-[520px]:border-r-0 max-[820px]:max-h-[180px] max-[820px]:border-b max-[820px]:border-r-0" aria-label={uiText("Registos de conhecimento")}>
        <div className="flex min-h-9 items-center justify-between gap-2 px-2 pb-1 text-whx-soft"><span className="inline-flex items-center gap-2 text-whx-label font-semibold"><Icon name="list" size={14}/>{uiText("Conhecimentos")}</span><b className="min-w-7 rounded-md bg-whx-muted px-1.5 py-1 text-center font-mono text-whx-support font-semibold">{visible.length}</b></div>
        {visible.map((entry) => {
          const currentCategory = entry.category || 'general'
          const isSelected = selectedEntry?.id === entry.id
          return <button type="button" key={entry.id} aria-current={isSelected ? 'page' : undefined} className={`flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-lg border-l-2 px-2.5 py-2 text-left leading-tight transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-whx-accent ${isSelected ? 'border-whx-accent bg-whx-accent-soft text-whx-text' : 'border-transparent bg-transparent text-whx-soft hover:bg-whx-hover hover:text-whx-text'}`} onClick={() => setSelected(entry.id)}><Icon name="knowledge" size={15}/><span className="min-w-0 flex-1"><span className="block truncate font-medium text-whx-readable" title={entry.id}>{entry.id}</span><small className="mt-0.5 block truncate text-whx-support text-whx-faint">{uiText(categoryLabel[currentCategory])}</small></span></button>
        })}
        {!visible.length && <div className="p-3 text-whx-label leading-relaxed text-whx-faint" role="status">{uiText("Nenhum registo corresponde aos filtros.")}</div>}
      </nav>
      <article className="project-knowledge-content min-h-0 min-w-0 overflow-auto px-4 pb-5 pt-3 text-whx-text @max-[520px]:px-3 max-[820px]:px-3">
        {error && <div className="mb-3 rounded-md border border-whx-danger/50 bg-whx-danger/10 px-3 py-2 text-whx-readable leading-relaxed text-whx-danger" role="alert">{error}</div>}
        {selectedEntry && <>
          <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-whx-border-soft pb-3"><strong className="min-w-0 flex-1 break-words font-mono text-whx-title font-semibold leading-relaxed">{selectedEntry.id}</strong><span className="rounded-md border border-whx-border-soft bg-whx-muted px-2 py-1 text-whx-support text-whx-soft">{uiText(categoryLabel[selectedEntry.category || 'general'])}</span>{selfEvolutionCategories.has(selectedEntry.category || 'general') && <span className="rounded-md border border-whx-accent/40 bg-whx-accent-soft px-2 py-1 text-whx-support text-whx-accent">{uiText("auto-evolução")}</span>}<time className="text-whx-support text-whx-faint" dateTime={selectedEntry.updated_at} title={new Date(selectedEntry.updated_at).toLocaleString(interfaceLocale())}>v{selectedEntry.version} · {new Date(selectedEntry.updated_at).toLocaleDateString(interfaceLocale())}</time></div>
          <div className="mx-auto w-full max-w-[920px] [&_.markdown-content]:!text-whx-readable [&_.markdown-content]:!leading-[1.5] [&_h1]:!text-whx-heading [&_h2]:!text-whx-title [&_h3]:!text-whx-readable [&_code]:!text-whx-support">
            <TranslatableMarkdown sessionId={session.id} markdown={selectedEntry.content}/>
          </div>
        </>}
      </article>
    </div>}
  </section>
}
