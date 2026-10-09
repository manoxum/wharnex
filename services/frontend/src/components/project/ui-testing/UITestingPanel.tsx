import { WorkbenchTabs } from '../../presentation/tabs'
import { useCallback, useEffect, useState } from 'react'
import type { Session, UITestingDocument } from '../../../types'
import { uiTestingApi } from '../../../lib/ui-testing/uiTestingApi'
import { Icon } from '../../presentation/chrome/Icon'
import { UITestsTab } from './catalog'
import { UIDocsTab } from './documentation'
import { UIConfigTab } from './configuration'
import { UITestDesignComposer } from './UITestDesignComposer'
import { UIAutomationHolds } from './automation'

type Tab = 'tests' | 'docs' | 'config'
export function UITestingPanel({ session, onError }: { session: Session; onError: (message: string) => void }) {
  const [tab, setTab] = useState<Tab>('tests'); const [doc, setDoc] = useState<UITestingDocument>(); const [busy, setBusy] = useState(false); const [composing, setComposing] = useState(false)
  const load = useCallback(async () => { try { setDoc(await uiTestingApi.get(session.id)) } catch (error) { onError(messageOf(error)) } }, [onError, session.id])
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 3000); return () => window.clearInterval(timer) }, [load])
  async function act(run: () => Promise<unknown>) { setBusy(true); try { await run(); await load() } catch (error) { onError(messageOf(error)); throw error } finally { setBusy(false) } }
  const quietly = (run: () => Promise<unknown>) => { void act(run).catch(() => undefined) }
  if (!doc) return <div className="grid h-full place-items-center text-base text-whx-faint">A carregar UI Lab…</div>
  return <section className="@container flex h-full min-h-0 flex-col bg-whx-bg">
    <header className="flex items-start gap-3 border-b border-whx-border px-4 py-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-whx-accent-soft text-whx-accent"><Icon name="flask" size={18}/></span>
      <div className="min-w-0"><h2 className="m-0! text-lg! font-semibold! leading-6! text-whx-text">Teste de UI</h2><p className="m-0! text-base! leading-5! text-whx-faint">Cenários, resultados e guias de utilização.</p></div>
    </header>
    <UIAutomationHolds onError={onError}/>
    <WorkbenchTabs label="Áreas do UI Lab" value={tab} onChange={setTab} items={[
      { id: 'tests', label: 'Testes UI', icon: 'flask', badge: doc.tests.length },
      { id: 'docs', label: 'Documentação', icon: 'knowledge', badge: doc.guides.length },
      { id: 'config', label: 'Configuração', icon: 'settings' },
    ]}/>
    {tab === 'tests'
      ? <UITestsTab doc={doc} busy={busy} onSync={() => quietly(() => uiTestingApi.sync(session.id))} onRun={(ids) => quietly(() => uiTestingApi.run(session.id, ids))} onConfigure={() => setTab('config')} onNew={() => setComposing(true)} onDismissDesign={(taskId) => quietly(() => uiTestingApi.dismissDesign(session.id, taskId))}/>
      : tab === 'docs' ? <UIDocsTab sessionId={session.id} doc={doc}/>
        : <UIConfigTab doc={doc} busy={busy} onSave={(input) => act(() => uiTestingApi.configure(session.id, input))} onClearSessions={(environmentId) => quietly(() => uiTestingApi.clearSessions(session.id, environmentId))}/>}
    {composing && <UITestDesignComposer environments={doc.environments} busy={busy} onClose={() => setComposing(false)} onSubmit={(input) => act(() => uiTestingApi.design(session.id, input))}/>}
  </section>
}
function messageOf(value: unknown) { return value instanceof Error ? value.message : String(value) }
