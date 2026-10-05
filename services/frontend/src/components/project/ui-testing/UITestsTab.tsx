import { useMemo, useState } from 'react'
import type { UITestingDocument } from '../../../types'
import { configurationIssue, groupByEnvironment } from '../../../lib/ui-testing/uiTestingCatalog'
import { Icon } from '../../presentation/chrome/Icon'
import { UIDesignRequests } from './UIDesignRequests'
import { UITestCard } from './UITestCard'
import { uiPrimaryButtonClass, uiSecondaryButtonClass } from './uiTestingStyles'

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
  const [selected, setSelected] = useState<string[]>([])
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const configurationIssues = useMemo(() => new Map(doc.tests.flatMap((test) => {
    const issue = configurationIssue(doc, test)
    return issue ? [[test.id, issue]] : []
  })), [doc])
  const groups = useMemo(() => groupByEnvironment(doc, doc.tests, (test) => test.environment_id), [doc])
  const selectedBlocked = selected.some((id) => configurationIssues.has(id))
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  return <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="min-w-0 flex-1"><strong className="block text-sm text-[var(--theme-text)]">Catálogo de testes</strong><span className="text-xs text-[var(--theme-text-muted)]">{doc.tests.length} cenários · {groups.length} ambiente{groups.length === 1 ? '' : 's'} · {syncLabel(doc.sync_status)}</span></div>
      {onNew && <button className={uiSecondaryButtonClass} disabled={busy} onClick={onNew}><Icon name="plus" size={13}/> Novo</button>}
      <button className={uiSecondaryButtonClass} disabled={busy || doc.sync_status === 'syncing'} onClick={onSync}><Icon name="refresh" size={13}/> Sincronizar</button>
      <button className={uiPrimaryButtonClass} disabled={busy || !selected.length || selectedBlocked} onClick={() => onRun(selected)}><Icon name="play" size={13}/> Executar selecionados</button>
      <button className={uiSecondaryButtonClass} disabled={busy || !doc.tests.length || configurationIssues.size > 0} onClick={() => onRun([])}>Executar todos</button>
    </div>
    {doc.sync_status === 'failed' && <div role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs leading-5 text-red-200">{doc.sync_error || 'A sincronização falhou. Tente sincronizar novamente.'}</div>}
    {configurationIssues.size > 0 && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs leading-5 text-amber-100">
      <span className="min-w-0 flex-1">{configurationIssues.values().next().value} {configurationIssues.size > 1 ? `Há ${configurationIssues.size} testes por configurar.` : ''}</span>
      <button className={uiSecondaryButtonClass} onClick={onConfigure}>Configurar ambiente</button>
    </div>}
    {doc.sync_summary && doc.sync_status === 'ready' && <details className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-xs"><summary className="cursor-pointer text-[var(--theme-text-muted)]">Resumo da última sincronização</summary><p className="mt-2 whitespace-pre-wrap leading-5">{doc.sync_summary}</p></details>}
    <UIDesignRequests designs={doc.designs || []} onDismiss={(taskId) => onDismissDesign?.(taskId)}/>
    <div className="min-h-0 flex-1 space-y-4 overflow-auto pr-1">
      {!doc.tests.length && <Empty text={emptyLabel(doc)}/>}
      {groups.map(({ environment, items }) => <section key={environment.id} aria-label={`Ambiente ${environment.name}`} className="space-y-2">
        <header className="sticky top-0 z-[1] flex items-center gap-2 bg-[var(--theme-bg)] py-1">
          <Icon name="server" size={13}/>
          <strong className="text-xs">{environment.name}</strong>
          <span className="text-[10px] text-[var(--theme-text-muted)]">{items.length} teste{items.length === 1 ? '' : 's'} · {environment.url || 'URL por configurar'}</span>
          <button className="ml-auto text-[10px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]" onClick={() => setSelected((current) => [...new Set([...current, ...items.map((test) => test.id)])])}>Selecionar ambiente</button>
        </header>
        {items.map((test) => <UITestCard key={test.id} doc={doc} test={test} selected={selectedSet.has(test.id)} issue={configurationIssues.get(test.id) || ''} onToggle={() => toggle(test.id)}/>)}
      </section>)}
    </div>
  </div>
}
function syncLabel(status: string) { return status === 'syncing' ? 'GPT a sincronizar contexto…' : status === 'failed' ? 'última sincronização falhou' : status === 'ready' ? 'sincronizado com o projeto' : 'ainda não sincronizado' }
function emptyLabel(doc: UITestingDocument) { return doc.sync_status === 'syncing' ? 'A analisar o contexto completo do projeto…' : doc.sync_status === 'failed' ? 'A descoberta falhou. Use Sincronizar para tentar novamente.' : 'Sincronize para o GPT descobrir os testes de UI, ou use Novo para descrever um teste.' }
function Empty({ text }: { text: string }) { return <div className="grid min-h-52 place-items-center rounded-xl border border-dashed border-white/10 p-8 text-center text-xs text-[var(--theme-text-muted)]">{text}</div> }
