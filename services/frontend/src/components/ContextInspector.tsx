import { useMemo, useState } from 'react'
import type { ContextInspection } from '../types'
import { Icon } from './Icon'

type View = 'roots' | 'final' | 'rules'
type Filter = 'all' | 'included' | 'excluded'

export function ContextInspector({ inspection, refreshing, onRefresh }: {
  inspection: ContextInspection
  refreshing: boolean
  onRefresh: () => void
}) {
  const [view, setView] = useState<View>('final')
  const [filter, setFilter] = useState<Filter>('included')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(300)
  const entries = inspection.entries || []
  const roots = inspection.roots || []
  const rules = inspection.rules || []
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return entries.filter((entry) => {
      if (filter !== 'all' && entry.status !== filter) return false
      if (!needle) return true
      return entry.path.toLowerCase().includes(needle) || (entry.reason || '').toLowerCase().includes(needle) || (entry.rule || '').toLowerCase().includes(needle)
    })
  }, [entries, filter, query])
  const shown = filtered.slice(0, limit)

  function changeFilter(next: Filter) { setFilter(next); setLimit(300) }
  function changeQuery(next: string) { setQuery(next); setLimit(300) }

  return <section className="context-inspector">
    <div className="context-summary-grid">
      <Summary label="No ZIP final" value={String(inspection.included_files)} detail={formatBytes(inspection.included_bytes)} tone="ok" />
      <Summary label="Excluídos" value={String(inspection.excluded_items)} detail="itens/subárvores" tone="muted" />
      <Summary label="Raiz" value={String(roots.length)} detail="pastas + ficheiros" tone="muted" />
      <Summary label="Snapshot" value={inspection.sha256.slice(0, 10)} detail={inspection.snapshot_id} tone="mono" />
    </div>
    <div className="context-inspector-bar">
      <div className="context-view-switch" role="tablist" aria-label="Explorador do contexto">
        <button className={view === 'final' ? 'active' : ''} onClick={() => setView('final')}>Conteúdo final</button>
        <button className={view === 'roots' ? 'active' : ''} onClick={() => setView('roots')}>Estrutura base</button>
        <button className={view === 'rules' ? 'active' : ''} onClick={() => setView('rules')}>Regras</button>
      </div>
      <button className="secondary-button compact" disabled={refreshing} onClick={onRefresh} title="Reconstruir o ZIP e atualizar esta inspeção"><Icon name="refresh" size={13}/>{refreshing ? 'A reconstruir…' : 'Reconstruir contexto'}</button>
    </div>
    {view === 'final' && <div className="context-final-view">
      <div className="context-final-toolbar">
        <div className="context-filter-switch">
          <button className={filter === 'included' ? 'active included' : ''} onClick={() => changeFilter('included')}>Incluídos {inspection.included_files}</button>
          <button className={filter === 'excluded' ? 'active excluded' : ''} onClick={() => changeFilter('excluded')}>Excluídos {inspection.excluded_items}</button>
          <button className={filter === 'all' ? 'active' : ''} onClick={() => changeFilter('all')}>Todos</button>
        </div>
        <label className="context-search"><Icon name="search" size={13}/><input value={query} onChange={(event) => changeQuery(event.target.value)} placeholder="Pesquisar caminho, regra ou motivo…" />{query && <button onClick={() => changeQuery('')} title="Limpar"><Icon name="close" size={12}/></button>}</label>
      </div>
      <div className="context-inventory" role="list">
        {shown.map((entry) => <div className={`context-inventory-row ${entry.status}`} role="listitem" key={`${entry.status}:${entry.path}`}>
          <Icon name={entry.kind === 'directory' ? 'folder' : 'file'} size={14}/>
          <div className="context-inventory-main"><code>{entry.path}</code>{entry.status === 'excluded' && <small>{entry.reason || 'excluído'}{entry.rule ? ` · ${entry.rule}` : ''}</small>}</div>
          {entry.status === 'included' ? <span className="context-status included">IN ZIP</span> : <span className="context-status excluded">FORA</span>}
          {entry.size ? <span className="context-size">{formatBytes(entry.size)}</span> : null}
        </div>)}
        {!shown.length && <div className="context-empty">Nenhum item corresponde ao filtro.</div>}
      </div>
      <div className="context-list-footer"><span>A mostrar {shown.length} de {filtered.length} itens</span>{shown.length < filtered.length && <button onClick={() => setLimit((value) => value + 300)}>Mostrar mais 300</button>}</div>
    </div>}
    {view === 'roots' && <div className="context-roots"><div className="context-section-intro"><strong>Pastas base e ficheiros específicos</strong><span>Estado calculado contra o snapshot final, não apenas contra a configuração.</span></div>{roots.map((root) => <div className={`context-root-row ${root.status}`} key={root.path}>
      <Icon name={root.kind === 'directory' ? 'folder' : 'file'} size={15}/><div><code>{root.name}</code><small>{root.included_files} incluídos · {root.excluded_items} excluídos{root.reason ? ` · ${root.reason}` : ''}</small></div><span className={`context-status ${root.status}`}>{rootLabel(root.status)}</span><span className="context-size">{root.included_bytes ? formatBytes(root.included_bytes) : '—'}</span>
    </div>)}</div>}
    {view === 'rules' && <div className="context-rules"><div className="context-section-intro"><strong>Todas as regras de exclusão/inclusão aplicadas</strong><span>As regras obrigatórias do Wharness têm precedência sobre <code>whaness.yml</code>.</span></div>{rules.map((rule) => <article className={`context-rule-card ${rule.enabled ? '' : 'disabled'}`} key={rule.id}><header><div><strong>{rule.label}</strong><span>{rule.source}</span></div><span className={`context-rule-state ${rule.enabled ? 'enabled' : ''}`}>{rule.enabled ? 'ATIVA' : 'INATIVA'}</span></header><p>{rule.description}</p><div className="context-patterns">{(rule.patterns || []).length ? (rule.patterns || []).map((pattern) => <code key={pattern}>{pattern}</code>) : <span>sem padrões configurados</span>}</div></article>)}</div>}
  </section>
}

function Summary({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) { return <div className={`context-summary ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div> }
function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`; return `${(value / 1024 / 1024).toFixed(1)} MiB` }
function rootLabel(status: string) { if (status === 'included') return 'INCLUÍDO'; if (status === 'partial') return 'PARCIAL'; if (status === 'excluded') return 'EXCLUÍDO'; return 'SEM CONTEÚDO' }
