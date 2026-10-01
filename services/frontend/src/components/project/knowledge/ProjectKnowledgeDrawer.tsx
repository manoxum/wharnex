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
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os conhecimentos do projeto.')
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
    try { await onConsolidate() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível iniciar a consolidação.') } finally { setConsolidating(false) }
  }

  return <section className="project-knowledge-drawer" aria-label="Conhecimento do projeto">
    <header className="agent-drawer-heading">
      <div><span className="panel-kicker">Memória incremental</span><strong>Conhecimento do projeto</strong></div>
      <div className="project-knowledge-heading-actions">
        <button type="button" className="agent-drawer-icon" onClick={() => void refresh()} disabled={loading} aria-label="Atualizar conhecimentos" title="Atualizar"><Icon name="refresh" size={13}/></button>
        <button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar conhecimentos"><Icon name="close" size={13}/></button>
      </div>
    </header>
    {catalog && <div className="project-knowledge-toolbar">
      <div className="project-knowledge-meta"><span className="project-knowledge-version"><Icon name="knowledge" size={12}/>r{catalog.revision}</span><span>{catalog.entries.length} registos</span><span>{operationalCount} úteis para auto-evolução</span></div>
      <div className="flex flex-wrap gap-2">
        <label className="panel-search-field project-knowledge-search"><Icon name="search" size={13}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar conhecimentos" aria-label="Pesquisar conhecimentos"/>{query && <button type="button" onClick={() => setQuery('')} aria-label="Limpar pesquisa"><Icon name="close" size={11}/></button>}</label>
        <select aria-label="Filtrar categoria de conhecimento" className="rounded border border-whx-border bg-whx-elevated px-2 text-xs" value={category} onChange={(event) => setCategory(event.target.value as KnowledgeCategory | '')}><option value="">Todas as categorias</option>{categories.map((value) => <option key={value} value={value}>{categoryLabel[value as KnowledgeCategory] || value}</option>)}</select>
        <button type="button" className="inline-flex items-center gap-1.5 rounded border border-whx-border bg-whx-elevated px-2 py-1.5 text-xs font-semibold hover:bg-whx-hover disabled:opacity-50" disabled={busy || consolidating || consolidationInFlight || catalog.entries.length < 2 || !onConsolidate} onClick={() => void consolidate()} title={consolidationInFlight ? 'A consolidação deste catálogo já está em curso neste chat' : 'Enviar o catálogo completo ao GPT para deduplicar, reconciliar e reorganizar'}><Icon name="sparkles" size={12}/> {consolidationInFlight ? 'Consolidação em curso' : consolidating ? 'A preparar…' : 'Consolidar com GPT'}</button>
      </div>
      <p className="m-0 text-[10px] leading-5 text-whx-faint">A consolidação envia o catálogo completo num pedido de manutenção, remove vazios/duplicados, reconcilia contradições pela evidência e recência e grava o catálogo resultante no banco de dados. Conhecimento de domínio permanece fora da auto-evolução.</p>
    </div>}
    {loading && !catalog ? <ContentSkeleton label="A carregar conhecimentos adquiridos" rows={5}/> : error && !catalog ? <div className="agent-drawer-empty">{error}</div> : !catalog || !catalog.entries.length ? <div className="agent-drawer-empty">Ainda não há conhecimento persistido para este projeto.</div> : <div className="project-knowledge-layout">
      <nav className="project-knowledge-index" aria-label="Registos de conhecimento">
        <div className="project-knowledge-index-heading"><span><Icon name="list" size={13}/>Conhecimentos</span><b>{visible.length}</b></div>
        {visible.map((entry) => {
          const currentCategory = entry.category || 'general'
          return <button type="button" key={entry.id} className={selectedEntry?.id === entry.id ? 'active' : ''} onClick={() => setSelected(entry.id)}><Icon name="knowledge" size={12}/><span><span className="block truncate">{entry.id}</span><small className="block truncate text-[9px] text-whx-faint">{categoryLabel[currentCategory]}</small></span></button>
        })}
        {!visible.length && <div className="agent-drawer-empty">Nenhum registo corresponde aos filtros.</div>}
      </nav>
      <article className="project-knowledge-content">
        {error && <div className="project-knowledge-inline-error">{error}</div>}
        {selectedEntry && <>
          <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-whx-border pb-3"><strong>{selectedEntry.id}</strong><span className="rounded-full border border-whx-border bg-whx-muted px-2 py-0.5 text-[10px] text-whx-soft">{categoryLabel[selectedEntry.category || 'general']}</span>{selfEvolutionCategories.has(selectedEntry.category || 'general') && <span className="rounded-full border border-whx-accent/40 bg-whx-accent-soft px-2 py-0.5 text-[10px] text-whx-accent">auto-evolução</span>}<span className="text-[10px] text-whx-faint">v{selectedEntry.version} · {new Date(selectedEntry.updated_at).toLocaleString()}</span></div>
          <TranslatableMarkdown sessionId={session.id} markdown={selectedEntry.content}/>
        </>}
      </article>
    </div>}
  </section>
}
