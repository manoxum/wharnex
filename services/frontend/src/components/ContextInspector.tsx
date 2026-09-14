import { useMemo, useState } from 'react'
import type { ContextInspection, ContextInventoryEntry } from '../types'
import { Icon } from './Icon'

type View = 'files' | 'folders' | 'rules'
type Filter = 'all' | 'included' | 'excluded'
type SortKey = 'name' | 'type' | 'size' | 'created' | 'modified'
type Direction = 'asc' | 'desc'
export type ContextSelection = { path: string; kind: string; action: 'include' | 'exclude' }

type InventoryItem = ContextInventoryEntry & { includedFiles?: number; excludedItems?: number }

export function ContextInspector({ inspection, refreshing, configuring = false, onRefresh, onSelection }: {
  inspection: ContextInspection
  refreshing: boolean
  configuring?: boolean
  onRefresh: () => void
  onSelection?: (selection: ContextSelection) => void
}) {
  const [view, setView] = useState<View>('files')
  const [filter, setFilter] = useState<Filter>('included')
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('size')
  const [direction, setDirection] = useState<Direction>('desc')
  const [limit, setLimit] = useState(300)
  const entries = inspection.entries || []
  const rules = inspection.rules || []
  const folders = useMemo(() => buildFolders(entries), [entries])
  const visibleItems = view === 'folders' ? folders : entries.filter((entry) => entry.kind !== 'directory')
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return visibleItems.filter((entry) => {
      if (filter !== 'all' && entry.status !== filter && !(filter === 'included' && entry.status === 'partial')) return false
      if (!needle) return true
      return entry.path.toLowerCase().includes(needle) || (entry.reason || '').toLowerCase().includes(needle) || (entry.rule || '').toLowerCase().includes(needle)
    }).sort((left, right) => compareItems(left, right, sortKey, direction))
  }, [visibleItems, filter, query, sortKey, direction])
  const shown = filtered.slice(0, limit)

  function changeFilter(next: Filter) { setFilter(next); setLimit(300) }
  function changeQuery(next: string) { setQuery(next); setLimit(300) }
  function changeView(next: View) { setView(next); setLimit(300) }

  return <section className="context-inspector">
    <div className="context-summary-grid">
      <Summary label="No contexto" value={String(inspection.included_files)} detail={formatBytes(inspection.included_bytes)} tone="ok" />
      <Summary label="Excluídos" value={String(inspection.excluded_items)} detail="itens e subárvores" tone="muted" />
      <Summary label="Pastas" value={String(folders.length)} detail="visão consolidada" tone="muted" />
      <Summary label="Snapshot" value={inspection.sha256.slice(0, 10)} detail={inspection.snapshot_id} tone="mono" />
    </div>
    <div className="context-inspector-bar">
      <div className="context-view-switch" role="tablist" aria-label="Explorador do contexto">
        <button className={view === 'files' ? 'active' : ''} onClick={() => changeView('files')}><Icon name="file" size={13}/> Por ficheiro</button>
        <button className={view === 'folders' ? 'active' : ''} onClick={() => changeView('folders')}><Icon name="folder" size={13}/> Por pasta</button>
        <button className={view === 'rules' ? 'active' : ''} onClick={() => changeView('rules')}><Icon name="shield" size={13}/> Regras</button>
      </div>
      <button className="secondary-button compact" disabled={refreshing || configuring} onClick={onRefresh} title="Reconstruir o ZIP e atualizar esta inspeção"><Icon name="refresh" size={13}/>{refreshing ? 'A reconstruir…' : 'Reconstruir'}</button>
    </div>
    {view !== 'rules' && <div className="context-final-view">
      <div className="context-final-toolbar">
        <div className="context-filter-switch">
          <button className={filter === 'included' ? 'active included' : ''} onClick={() => changeFilter('included')}>Incluídos</button>
          <button className={filter === 'excluded' ? 'active excluded' : ''} onClick={() => changeFilter('excluded')}>Excluídos</button>
          <button className={filter === 'all' ? 'active' : ''} onClick={() => changeFilter('all')}>Todos</button>
        </div>
        <div className="context-sort-controls">
          <label><span>Ordenar</span><select aria-label="Ordenar contexto" value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}><option value="name">Nome</option><option value="type">Tipo</option><option value="size">Tamanho</option><option value="created">Criação</option><option value="modified">Última atualização</option></select></label>
          <button className="icon-button" aria-label={direction === 'asc' ? 'Ordem crescente' : 'Ordem decrescente'} title={direction === 'asc' ? 'Ordem crescente' : 'Ordem decrescente'} onClick={() => setDirection((value) => value === 'asc' ? 'desc' : 'asc')}><Icon name={direction === 'asc' ? 'arrow-up' : 'arrow-down'} size={14}/></button>
        </div>
        <label className="context-search"><Icon name="search" size={14}/><input value={query} onChange={(event) => changeQuery(event.target.value)} placeholder={`Pesquisar ${view === 'folders' ? 'pasta' : 'ficheiro'}, regra ou motivo…`} />{query && <button onClick={() => changeQuery('')} title="Limpar"><Icon name="close" size={12}/></button>}</label>
      </div>
      <div className="context-table-head" aria-hidden="true"><span/><span>Nome</span><span>Tipo</span><span>Tamanho</span><span>Criado</span><span>Atualizado</span><span>Contexto</span></div>
      <div className="context-inventory" role="list">
        {shown.map((entry) => <InventoryRow key={`${entry.status}:${entry.path}`} entry={entry} totalBytes={inspection.included_bytes} configuring={configuring} onSelection={onSelection}/>) }
        {!shown.length && <div className="context-empty"><Icon name={view === 'folders' ? 'folder' : 'file'} size={22}/><strong>Nenhum item encontrado</strong><span>Ajuste o filtro ou a pesquisa para ampliar os resultados.</span></div>}
      </div>
      <div className="context-list-footer"><span>A mostrar {shown.length} de {filtered.length} {view === 'folders' ? 'pastas' : 'ficheiros'}</span><span className="context-impact-legend"><i className="low"/>leve <i className="medium"/>médio <i className="high"/>alto</span>{shown.length < filtered.length && <button onClick={() => setLimit((value) => value + 300)}>Mostrar mais 300</button>}</div>
    </div>}
    {view === 'rules' && <div className="context-rules"><div className="context-section-intro"><strong>Política efetiva do snapshot</strong><span>As regras obrigatórias do Wharnex têm precedência sobre <code>whaness.yml</code>; as inclusões explícitas nunca abrem uma exceção de segurança.</span></div>{rules.map((rule) => <article className={`context-rule-card ${rule.enabled ? '' : 'disabled'}`} key={rule.id}><header><div><strong>{rule.label}</strong><span>{rule.source}</span></div><span className={`context-rule-state ${rule.enabled ? 'enabled' : ''}`}>{rule.enabled ? 'ATIVA' : 'INATIVA'}</span></header><p>{rule.description}</p><div className="context-patterns">{(rule.patterns || []).length ? (rule.patterns || []).map((pattern) => <code key={pattern}>{pattern}</code>) : <span>sem padrões configurados</span>}</div></article>)}</div>}
  </section>
}

function InventoryRow({ entry, totalBytes, configuring, onSelection }: { entry: InventoryItem; totalBytes: number; configuring: boolean; onSelection?: (selection: ContextSelection) => void }) {
  const excluded = entry.status === 'excluded'
  const action = excluded ? 'include' : 'exclude'
  const canChange = entry.configurable !== false && Boolean(onSelection)
  const detail = entry.kind === 'directory'
    ? `${entry.includedFiles || 0} incluídos · ${entry.excludedItems || 0} excluídos${entry.reason ? ` · ${entry.reason}` : ''}`
    : excluded ? `${entry.reason || 'excluído'}${entry.rule ? ` · ${entry.rule}` : ''}` : entry.path.split('/').slice(0, -1).join('/') || 'raiz do projeto'
  return <div className={`context-inventory-row ${entry.status} ${sizeImpact(entry.size || 0, totalBytes)}`} role="listitem">
    <span className="context-impact-mark" title={`Impacto no contexto: ${formatBytes(entry.size || 0)}`}/>
    <div className="context-inventory-main"><code title={entry.path}>{entry.path}</code><small title={detail}>{detail}</small></div>
    <span className="context-kind">{itemType(entry)}</span>
    <span className="context-size">{entry.size ? formatBytes(entry.size) : '—'}</span>
    <time className="context-date" dateTime={entry.created_at || ''}>{formatDate(entry.created_at)}</time>
    <time className="context-date" dateTime={entry.modified_at || ''}>{formatDate(entry.modified_at)}</time>
    <span className="context-action-cell"><span className={`context-status ${entry.status}`}>{excluded ? 'FORA' : entry.status === 'partial' ? 'PARCIAL' : 'INCLUÍDO'}</span>{canChange ? <button className={`context-selection-button ${action}`} disabled={configuring} title={`${action === 'include' ? 'Incluir' : 'Excluir'} ${entry.path}`} onClick={() => onSelection?.({ path: entry.path, kind: entry.kind, action })}><Icon name={action === 'include' ? 'plus' : 'close'} size={12}/>{configuring ? 'A aplicar…' : action === 'include' ? 'Incluir' : 'Excluir'}</button> : <span className="context-locked" title="Esta decisão é protegida e não pode ser alterada"><Icon name="shield" size={12}/></span>}</span>
  </div>
}

function buildFolders(entries: ContextInventoryEntry[]): InventoryItem[] {
  const folders = new Map<string, InventoryItem>()
  const ensure = (path: string) => {
    let folder = folders.get(path)
    if (!folder) {
      folder = { path, kind: 'directory', status: 'excluded', size: 0, configurable: false, includedFiles: 0, excludedItems: 0 }
      folders.set(path, folder)
    }
    return folder
  }
  for (const entry of entries) {
    const segments = entry.path.split('/').filter(Boolean)
    const folderCount = entry.kind === 'directory' ? segments.length : segments.length - 1
    for (let index = 1; index <= folderCount; index += 1) {
      const folder = ensure(segments.slice(0, index).join('/'))
      if (entry.status === 'included') { folder.includedFiles = (folder.includedFiles || 0) + 1; folder.size = (folder.size || 0) + (entry.size || 0) }
      else { folder.excludedItems = (folder.excludedItems || 0) + 1 }
      folder.configurable = folder.configurable || entry.configurable !== false || entry.status === 'included'
      folder.created_at = earlierDate(folder.created_at, entry.created_at)
      folder.modified_at = laterDate(folder.modified_at, entry.modified_at)
      if (entry.path === folder.path) { folder.reason = entry.reason; folder.rule = entry.rule; folder.configurable = entry.configurable !== false }
    }
  }
  return Array.from(folders.values()).map((folder) => ({ ...folder, status: folder.includedFiles && folder.excludedItems ? 'partial' : folder.includedFiles ? 'included' : 'excluded' }))
}

function compareItems(left: InventoryItem, right: InventoryItem, key: SortKey, direction: Direction) {
  const sign = direction === 'asc' ? 1 : -1
  let value = 0
  if (key === 'size') value = (left.size || 0) - (right.size || 0)
  else if (key === 'created') value = dateValue(left.created_at) - dateValue(right.created_at)
  else if (key === 'modified') value = dateValue(left.modified_at) - dateValue(right.modified_at)
  else if (key === 'type') value = itemType(left).localeCompare(itemType(right), 'pt')
  else value = left.path.localeCompare(right.path, 'pt', { sensitivity: 'base' })
  return value === 0 ? left.path.localeCompare(right.path, 'pt', { sensitivity: 'base' }) : value * sign
}

function itemType(entry: InventoryItem) { if (entry.kind === 'directory') return 'Pasta'; const name = entry.path.split('/').pop() || ''; const dot = name.lastIndexOf('.'); return dot > 0 ? name.slice(dot + 1).toUpperCase() : 'Ficheiro' }
function dateValue(value?: string) { return value ? new Date(value).getTime() || 0 : 0 }
function earlierDate(current?: string, next?: string) { if (!current) return next; if (!next) return current; return dateValue(next) < dateValue(current) ? next : current }
function laterDate(current?: string, next?: string) { if (!current) return next; if (!next) return current; return dateValue(next) > dateValue(current) ? next : current }
function sizeImpact(value: number, total: number) { if (!value) return 'impact-none'; if (value >= 1024 * 1024 || value >= total * .12) return 'impact-high'; if (value >= 128 * 1024 || value >= total * .035) return 'impact-medium'; return 'impact-low' }
function formatDate(value?: string) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: 'short', year: '2-digit' }).format(date) }
function Summary({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) { return <div className={`context-summary ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div> }
function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`; return `${(value / 1024 / 1024).toFixed(1)} MiB` }
