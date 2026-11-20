import { useState } from 'react'
import { api } from '../../../src/lib/transport/http/api'
import { session, projectPath } from '../catalog'
import { ProjectKnowledgeDrawer } from '../../../src/components/project/knowledge/ProjectKnowledgeDrawer'
import { AgentRuntimeDetails } from '../../../src/components/agent/runtime/presentation'
import { AgentRuntimeHeader } from '../../../src/components/agent/runtime/presentation'
import { SettingsGroup, SettingsPage } from '../../../src/components/project/settings/presentation'
import { Field, Input } from '../../../src/components/presentation/workbench'
import { QuickSwitcher } from '../../../src/components/workspace/shell/QuickSwitcher'
import { AttentionPopover } from '../../../src/components/attention/center/AttentionPopover'
const noop = () => {}
const agent: DesktopAgentRuntimeAgent = {
  id: 'worker-1', label: 'Worker 1', role: 'worker', status: 'running', draining: false,
  chat_id: 'chat', error: '', loop_active: true,
  browser: { available: true, web_contents_id: 1, url: 'https://chatgpt.com/', title: 'Plano', loading: false },
}
const catalog = { project_path: projectPath, revision: 2, updated_at: '2026-10-16T10:00:00Z', updated_by_request_id: 'fixture', entries: [
  { id: 'Guardar', category: 'product_domain' as const, version: 2, updated_at: '2026-10-16T10:00:00Z', content: '# Plano de entrega\n\nO conteúdo original fica em Português.\n\n- Preservar os dados\n- Verificar os resultados' },
] }
Object.assign(api, { projectKnowledgeCatalog: async () => ({ catalog }) })
export function ContentFixture() {
  const [draft, setDraft] = useState('Draft stays here')
  const [alerts, showAlerts] = useState(false)
  return <main className="min-h-screen bg-whx-bg p-4 text-whx-body text-whx-text">
    <header className="mb-4 flex items-center justify-between"><h1 data-testid="major-title" className="m-0 text-2xl font-semibold">Workbench</h1><div className="flex items-center gap-2"><button onClick={() => showAlerts(!alerts)}>Notifications</button><QuickSwitcher/></div></header>
    <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)] items-start gap-4 max-[900px]:grid-cols-1">
      <section data-testid="knowledge" className="h-[480px] min-w-0 overflow-hidden rounded-lg border border-whx-border-soft"><ProjectKnowledgeDrawer session={session} onClose={noop}/></section>
      <section data-testid="agent" className="min-w-0 rounded-lg border border-whx-border-soft bg-whx-surface"><AgentRuntimeHeader onClose={noop}/><div className="p-3"><AgentRuntimeDetails agent={agent} projectPath={projectPath} projectName="Atlas" projectId={projectPath} taskIsCurrent={false} stateLabel="A escutar"/></div></section>
      <div className="rounded-lg border border-whx-border-soft"><SettingsPage title="Editor settings" description="This introduction is available on hover."><SettingsGroup title="Files"><Field label="Default name"><Input aria-label="Draft" value={draft} onChange={(event) => setDraft(event.target.value)}/></Field></SettingsGroup></SettingsPage></div>
    </div>
    {alerts && <AttentionPopover items={[{ id: 'notice', chatId: 'chat', chatTitle: 'Plano', title: 'Guardar alterações?', detail: 'O conteúdo original fica em Português.', tone: 'warning', action: 'approve-execution' }]} activeChatId="chat" busy={false} position={{ top: 52, right: 16 }} onOpen={async () => {}} onAction={async () => {}} onOpenAll={noop} onClose={() => showAlerts(false)}/>}
  </main>
}
