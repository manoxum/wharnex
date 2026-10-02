import { useMemo, useState } from 'react'
import type { UITestingDocument } from '../../../types'
import { Icon } from '../../presentation/chrome/Icon'
import { uiPrimaryButtonClass, uiSecondaryButtonClass } from './uiTestingStyles'

export function UITestsTab({ doc, busy, onSync, onRun }: { doc: UITestingDocument; busy: boolean; onSync: () => void; onRun: (ids: string[]) => void }) {
  const [selected, setSelected] = useState<string[]>([])
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  return <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="min-w-0 flex-1"><strong className="block text-sm text-[var(--theme-text)]">Catálogo de testes</strong><span className="text-xs text-[var(--theme-text-muted)]">{doc.tests.length} cenários · {syncLabel(doc.sync_status)}</span></div>
      <button className={uiSecondaryButtonClass} disabled={busy || doc.sync_status === 'syncing'} onClick={onSync}><Icon name="refresh" size={13}/> Sincronizar</button>
      <button className={uiPrimaryButtonClass} disabled={busy || !selected.length} onClick={() => onRun(selected)}><Icon name="play" size={13}/> Executar selecionados</button>
      <button className={uiSecondaryButtonClass} disabled={busy || !doc.tests.length} onClick={() => onRun([])}>Executar todos</button>
    </div>
    {doc.sync_status === 'failed' && <div role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs leading-5 text-red-200">{doc.sync_error || 'A sincronização falhou. Tente sincronizar novamente.'}</div>}
    <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
      {!doc.tests.length && <Empty text={emptyLabel(doc)}/>}
      {doc.tests.map((test) => <label key={test.id} className="flex cursor-pointer gap-3 rounded-xl border border-white/10 bg-black/10 p-3 hover:border-[var(--acid)]/50">
        <input type="checkbox" className="mt-1" checked={selectedSet.has(test.id)} onChange={() => toggle(test.id)}/>
        <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><strong className="truncate text-sm">{test.title}</strong><Status value={test.status}/></span><span className="mt-1 block text-xs leading-5 text-[var(--theme-text-muted)]">{test.description || test.goal}</span><code className="mt-2 inline-block text-[10px] text-[var(--theme-text-muted)]">{test.environment_id}{test.profile_id ? ` · ${test.profile_id}` : ''}</code></span>
      </label>)}
    </div>
  </div>
}
function syncLabel(status: string) { return status === 'syncing' ? 'GPT a sincronizar contexto…' : status === 'failed' ? 'última sincronização falhou' : status === 'ready' ? 'sincronizado com o projeto' : 'ainda não sincronizado' }
function emptyLabel(doc: UITestingDocument) { return doc.sync_status === 'syncing' ? 'A analisar o contexto completo do projeto…' : doc.sync_status === 'failed' ? 'A descoberta falhou. Use Sincronizar para tentar novamente.' : 'Sincronize para o GPT descobrir os testes de UI.' }
function Status({ value }: { value: string }) { const tone = value === 'passed' ? 'text-emerald-400' : value === 'failed' ? 'text-red-400' : value === 'running' ? 'text-amber-300' : 'text-[var(--theme-text-muted)]'; return <span className={`rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide ${tone}`}>{value}</span> }
function Empty({ text }: { text: string }) { return <div className="grid min-h-52 place-items-center rounded-xl border border-dashed border-white/10 p-8 text-center text-xs text-[var(--theme-text-muted)]">{text}</div> }
