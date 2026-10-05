import { useCallback, useEffect, useState } from 'react'
import type { Session, UITestingDocument } from '../../../types'
import { uiTestingApi } from '../../../lib/ui-testing/uiTestingApi'
import { Icon } from '../../presentation/chrome/Icon'
import { UITestsTab } from './UITestsTab'
import { UIDocsTab } from './UIDocsTab'
import { UIConfigTab } from './UIConfigTab'
import { UITestDesignComposer } from './UITestDesignComposer'

type Tab = 'tests' | 'docs' | 'config'
export function UITestingPanel({ session, onError }: { session: Session; onError: (message: string) => void }) {
  const [tab, setTab] = useState<Tab>('tests'); const [doc, setDoc] = useState<UITestingDocument>(); const [busy, setBusy] = useState(false); const [composing, setComposing] = useState(false)
  const load = useCallback(async () => { try { setDoc(await uiTestingApi.get(session.id)) } catch (error) { onError(messageOf(error)) } }, [onError, session.id])
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 3000); return () => window.clearInterval(timer) }, [load])
  async function act(run: () => Promise<unknown>) { setBusy(true); try { await run(); await load() } catch (error) { onError(messageOf(error)); throw error } finally { setBusy(false) } }
  const quietly = (run: () => Promise<unknown>) => { void act(run).catch(() => undefined) }
  if (!doc) return <div className="grid h-full place-items-center text-xs text-[var(--theme-text-muted)]">A carregar UI Lab…</div>
  return <section className="flex h-full min-h-0 flex-col bg-[var(--theme-bg)]">
    <header className="border-b border-white/10 bg-gradient-to-br from-white/[0.04] to-transparent p-4"><div className="flex items-start gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl border border-[var(--acid)]/30 bg-[var(--acid)]/10 text-[var(--acid)]"><Icon name="flask" size={18}/></span><div><span className="text-[10px] uppercase tracking-[0.22em] text-[var(--acid)]">UI Lab</span><h2 className="text-base font-semibold">Debug, testes e user guide</h2><p className="mt-1 text-xs text-[var(--theme-text-muted)]">GPT orienta · Browser Worker executa · cada passo fica documentado.</p></div></div></header>
    <nav className="grid grid-cols-3 border-b border-white/10 p-2">{([['tests','Testes UI'],['docs','Documentação'],['config','Configuração']] as const).map(([id,label]) => <button key={id} className={`rounded-lg px-2 py-2 text-xs ${tab === id ? 'bg-white/10 text-[var(--theme-text)]' : 'text-[var(--theme-text-muted)] hover:bg-white/5'}`} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {tab === 'tests'
      ? <UITestsTab doc={doc} busy={busy} onSync={() => quietly(() => uiTestingApi.sync(session.id))} onRun={(ids) => quietly(() => uiTestingApi.run(session.id, ids))} onConfigure={() => setTab('config')} onNew={() => setComposing(true)} onDismissDesign={(taskId) => quietly(() => uiTestingApi.dismissDesign(session.id, taskId))}/>
      : tab === 'docs' ? <UIDocsTab sessionId={session.id} doc={doc}/>
        : <UIConfigTab doc={doc} busy={busy} onSave={(input) => act(() => uiTestingApi.configure(session.id, input)).catch(() => undefined)} onClearSessions={(environmentId) => quietly(() => uiTestingApi.clearSessions(session.id, environmentId))}/>}
    {composing && <UITestDesignComposer environments={doc.environments} busy={busy} onClose={() => setComposing(false)} onSubmit={(input) => act(() => uiTestingApi.design(session.id, input))}/>}
  </section>
}
function messageOf(value: unknown) { return value instanceof Error ? value.message : String(value) }
