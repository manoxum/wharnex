import { WorkbenchTabs } from '../../presentation/tabs'
import { useCallback, useEffect, useState } from 'react'
import type { Session, UITestingDocument } from '../../../types'
import { uiTestingApi } from '../../../lib/ui-testing/uiTestingApi'
import { IconButton, PanelHeader } from '../../presentation/workbench'
import { PanelSkeleton } from '../../presentation/chrome/Skeleton'
import { UITestsTab } from './catalog'
import { UIDocsTab } from './documentation'
import { UIConfigTab } from './configuration'
import { UITestDesignComposer } from './UITestDesignComposer'
import { UIAutomationHolds } from './automation'

type Tab = 'tests' | 'docs' | 'config'
export function UITestingPanel({ session, onError, onClose }: { session: Session; onError: (message: string) => void; onClose?: () => void }) {
  const [tab, setTab] = useState<Tab>('tests'); const [doc, setDoc] = useState<UITestingDocument>(); const [busy, setBusy] = useState(false); const [composing, setComposing] = useState(false)
  const load = useCallback(async () => { try { setDoc(await uiTestingApi.get(session.id)) } catch (error) { onError(messageOf(error)) } }, [onError, session.id])
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 3000); return () => window.clearInterval(timer) }, [load])
  async function act(run: () => Promise<unknown>) { setBusy(true); try { await run(); await load() } catch (error) { onError(messageOf(error)); throw error } finally { setBusy(false) } }
  const quietly = (run: () => Promise<unknown>) => { void act(run).catch(() => undefined) }
  if (!doc) return <PanelSkeleton/>
  return <section className="@container flex h-full min-h-0 flex-col bg-whx-bg">
    <PanelHeader title="Teste de UI" description="Cenários, resultados e guias de utilização." icon="flask" actions={onClose && <IconButton label="Fechar testes de UI" icon="close" onClick={onClose}/>}/>
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
