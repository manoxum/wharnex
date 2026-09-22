import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { ProjectKnowledge, Session } from '../types'
import { Icon } from './Icon'
import { ContentSkeleton } from './Skeleton'
import { TranslatableMarkdown } from './TranslatableMarkdown'
import { splitKnowledgeSections } from './projectKnowledgeSections'

export function ProjectKnowledgeDrawer({ session, onClose }: { session: Session; onClose: () => void }) {
  const [knowledge, setKnowledge] = useState<ProjectKnowledge | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('all')

  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const result = await api.projectKnowledge(session.id)
      setKnowledge(result.knowledge)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os conhecimentos do projeto.')
    } finally { setLoading(false) }
  }, [session.id])

  useEffect(() => { void refresh() }, [refresh, session.last_turn?.request_id])

  const sections = useMemo(() => splitKnowledgeSections(knowledge?.content || ''), [knowledge?.content])
  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    return term ? sections.filter((section) => `${section.title}\n${section.markdown}`.toLocaleLowerCase().includes(term)) : sections
  }, [query, sections])
  const selectedMarkdown = selected === 'all' ? knowledge?.content || '' : sections.find((section) => section.id === selected)?.markdown || knowledge?.content || ''

  return <section className="project-knowledge-drawer" aria-label="Conhecimento do projeto">
    <header className="agent-drawer-heading">
      <div><span className="panel-kicker">Memória incremental</span><strong>Conhecimento do projeto</strong></div>
      <div className="project-knowledge-heading-actions">
        <button type="button" className="agent-drawer-icon" onClick={() => void refresh()} disabled={loading} aria-label="Atualizar conhecimentos" title="Atualizar"><Icon name="refresh" size={13}/></button>
        <button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar conhecimentos"><Icon name="close" size={13}/></button>
      </div>
    </header>
    {knowledge && <div className="project-knowledge-toolbar">
      <div className="project-knowledge-meta"><span className="project-knowledge-version"><Icon name="knowledge" size={12}/>v{knowledge.version}</span><span>{new Date(knowledge.updated_at).toLocaleString()}</span>{knowledge.updated_by_request_id && <code>{knowledge.updated_by_request_id}</code>}</div>
      <label className="panel-search-field project-knowledge-search"><Icon name="search" size={13}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar conhecimentos" aria-label="Pesquisar conhecimentos"/>{query && <button type="button" onClick={() => setQuery('')} aria-label="Limpar pesquisa"><Icon name="close" size={11}/></button>}</label>
    </div>}
    {loading && !knowledge ? <ContentSkeleton label="A carregar conhecimentos adquiridos" rows={5}/> : error && !knowledge ? <div className="agent-drawer-empty">{error}</div> : !knowledge ? <div className="agent-drawer-empty">Ainda não há conhecimento persistido para este projeto. Ele é consolidado após alterações aplicadas e revistas.</div> : <div className="project-knowledge-layout">
      <nav className="project-knowledge-index" aria-label="Tópicos do conhecimento">
        <div className="project-knowledge-index-heading"><span><Icon name="list" size={13}/>Tópicos</span><b>{visible.length}</b></div>
        <button type="button" className={selected === 'all' ? 'active' : ''} onClick={() => setSelected('all')}><Icon name="clipboard" size={13}/><span>Documento completo</span></button>
        {visible.map((section) => <button type="button" key={section.id} className={selected === section.id ? 'active' : ''} onClick={() => setSelected(section.id)}><Icon name="knowledge" size={12}/><span>{section.title}</span></button>)}
        {!visible.length && <div className="agent-drawer-empty">Nenhum tópico corresponde à pesquisa.</div>}
      </nav>
      <article className="project-knowledge-content">
        {error && <div className="project-knowledge-inline-error">{error}</div>}
        <TranslatableMarkdown sessionId={session.id} markdown={selectedMarkdown}/>
      </article>
    </div>}
  </section>
}
