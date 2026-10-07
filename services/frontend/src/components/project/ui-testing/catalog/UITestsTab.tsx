import { useMemo, useState } from 'react'
import type { UITestingDocument } from '../../../../types'
import { configurationIssue, groupByEnvironment } from '../../../../lib/ui-testing/uiTestingCatalog'
import { Icon } from '../../../presentation/chrome/Icon'
import { UIDesignRequests } from './UIDesignRequests'
import { UITestOverview } from './UITestOverview'
import { uiInputClass } from '../uiTestingStyles'
import { UITestCard } from './UITestCard'
import { uiPrimaryButtonClass, uiSecondaryButtonClass } from '../uiTestingStyles'

type UITestsTabProps = {
  doc: UITestingDocument
  busy: boolean
  onSync: () => void
  onRun: (ids: string[]) => void
  onConfigure: () => void
  onNew?: () => void
  onDismissDesign?: (taskId: string) => void
}

export function UITestsTab({ doc, busy, onSync, onRun, onConfigure, onNew, onDismissDesign }: UITestsTabProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState<string[]>([])
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const configurationIssues = useMemo(() => new Map(doc.tests.flatMap((test) => {
    const issue = configurationIssue(doc, test)
    return issue ? [[test.id, issue]] : []
  })), [doc])
  const visibleTests = doc.tests.filter((test) => {
    return matchesStatus(test.status, filter) && `${test.title} ${test.description || ''} ${test.category || ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  })
  const groups = groupByEnvironment(doc, visibleTests, (test) => test.environment_id)
  const selectedIds = selected.filter((id) => doc.tests.some((test) => test.id === id))
  const selectedBlocked = selectedIds.some((id) => configurationIssues.has(id))
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  return <div className="@container flex min-h-0 flex-1 flex-col gap-3 p-4 text-whx-text">
    <UITestOverview tests={doc.tests}/>
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-0 flex-1 basis-full @min-[620px]:basis-auto"><strong className="block text-lg text-whx-text">Catálogo de testes</strong><span className="text-sm text-whx-faint">{doc.tests.length} cenários · {doc.environments.length} ambiente{doc.environments.length === 1 ? '' : 's'} · {syncLabel(doc.sync_status)}</span></div>
      {onNew && <button className={uiSecondaryButtonClass} disabled={busy} onClick={onNew}><Icon name="plus" size={13}/> Novo</button>}
      <button className={uiSecondaryButtonClass} disabled={busy || doc.sync_status === 'syncing'} onClick={onSync}><Icon name="refresh" size={13}/> Sincronizar</button>
      <button className={uiPrimaryButtonClass} disabled={busy || !selectedIds.length || selectedBlocked} onClick={() => onRun(selectedIds)}><Icon name="play" size={13}/> Executar selecionados{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}</button>
      <button className={uiSecondaryButtonClass} disabled={busy || !doc.tests.length || configurationIssues.size > 0} onClick={() => onRun([])}>Executar todos</button>
    </div>
    {doc.sync_status === 'failed' && <div role="alert" className="rounded-lg border border-whx-danger/30 bg-whx-danger/10 px-3 py-2 text-base leading-5 text-whx-danger">{doc.sync_error || 'A sincronização falhou. Tente sincronizar novamente.'}</div>}
    {configurationIssues.size > 0 && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-whx-warning/30 bg-whx-warning/10 px-3 py-2 text-base leading-5 text-whx-warning">
      <span className="min-w-0 flex-1">{configurationIssues.values().next().value} {configurationIssues.size > 1 ? `Há ${configurationIssues.size} testes por configurar.` : ''}</span>
      <button className={uiSecondaryButtonClass} onClick={onConfigure}>Configurar ambiente</button>
    </div>}
    {doc.sync_summary && doc.sync_status === 'ready' && <details className="rounded-lg border border-whx-border bg-whx-surface px-3 py-2 text-base"><summary className="cursor-pointer text-whx-faint">Resumo da última sincronização</summary><p className="mt-2 whitespace-pre-wrap leading-5">{doc.sync_summary}</p></details>}
    <UIDesignRequests designs={doc.designs || []} onDismiss={(taskId) => onDismissDesign?.(taskId)}/>
    <div className="flex flex-wrap items-center gap-2">
      <input aria-label="Pesquisar testes" type="search" className={`${uiInputClass} flex-1 basis-40`} placeholder="Pesquisar cenários…" value={query} onChange={(event) => setQuery(event.target.value)}/>
      <label className="flex items-center gap-2 text-sm text-whx-faint">Estado
        <select aria-label="Filtrar por estado" className={`${uiInputClass} w-auto!`} value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">Todos</option><option value="failed">Falhas e bloqueios</option><option value="active">Fila e execução</option><option value="passed">Aprovados</option><option value="ready">Por executar</option>
        </select>
      </label>
    </div>
    <div className="min-h-0 flex-1 space-y-4 overflow-auto pr-1">
      {!doc.tests.length && <Empty text={emptyLabel(doc)}/>}
      {doc.tests.length > 0 && !visibleTests.length && <Empty text="Nenhum teste corresponde à pesquisa e ao estado selecionado."/>}
      {groups.map(({ environment, items }) => <section key={environment.id} aria-label={`Ambiente ${environment.name}`} className="space-y-2">
        <header className="sticky top-0 z-[1] flex items-center gap-2 bg-whx-bg py-2">
          <Icon name="server" size={13}/>
          <div className="min-w-0 flex-1"><strong className="block text-base">{environment.name}</strong><span className="block truncate text-sm text-whx-faint" title={environment.url}>{items.length} teste{items.length === 1 ? '' : 's'} · {environment.url || 'URL por configurar'}</span></div>
          <button aria-label={`Selecionar ambiente ${environment.name}`} className={`${uiSecondaryButtonClass} ml-auto shrink-0`} onClick={() => setSelected((current) => [...new Set([...current, ...items.map((test) => test.id)])])}>Selecionar</button>
        </header>
        {items.map((test) => <UITestCard key={test.id} doc={doc} test={test} selected={selectedSet.has(test.id)} issue={configurationIssues.get(test.id) || ''} onToggle={() => toggle(test.id)}/>)}
      </section>)}
    </div>
  </div>
}
function syncLabel(status: string) { return status === 'syncing' ? 'GPT a sincronizar contexto…' : status === 'failed' ? 'última sincronização falhou' : status === 'ready' ? 'sincronizado com o projeto' : 'ainda não sincronizado' }
function emptyLabel(doc: UITestingDocument) { return doc.sync_status === 'syncing' ? 'A analisar o contexto completo do projeto…' : doc.sync_status === 'failed' ? 'A descoberta falhou. Use Sincronizar para tentar novamente.' : 'Sincronize para o GPT descobrir os testes de UI, ou use Novo para descrever um teste.' }
function Empty({ text }: { text: string }) { return <div className="grid min-h-52 place-items-center rounded-lg border border-dashed border-whx-border p-8 text-center text-sm text-whx-faint">{text}</div> }

function matchesStatus(status: string, filter: string) {
  if (filter === 'all') return true
  if (filter === 'failed') return ['failed', 'blocked'].includes(status)
  if (filter === 'active') return ['running', 'queued', 'waiting'].includes(status)
  return status === filter
}
