import { useState } from 'react'
import '../../src/styles/index.css'
import { ChatTabs } from '../../src/components/chat/navigation'
import { ProjectTabs } from '../../src/components/workspace/projects'
import { WorkbenchTabs } from '../../src/components/presentation/tabs'
import { BrowserMonitorList } from '../../src/components/agent/browser-monitor/BrowserMonitorList'
import { UITestingPanel } from '../../src/components/project/ui-testing/UITestingPanel'
import { EditorTabs } from '../../src/components/editor/canvas/EditorTabs'
import { TerminalTabBar } from '../../src/components/terminal/workspace/TerminalTabBar'
import { AgentSurfaceTabs } from '../../src/components/agent/workspace/AgentSurfaceTabs'
import type { InspectorTab } from '../../src/components/editor/inspector/Inspector'
import type { Session } from '../../src/types'

export function TabFixture() {
  const [chatSelected, setChatSelected] = useState(true)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('terminal')
  const [chatId, setChatId] = useState('first')
  const [project, setProject] = useState('/workspace/alpha')
  const [tab, setTab] = useState<string>('changes')
  const [file, setFile] = useState('src/App.tsx')
  return <main className="h-full overflow-auto bg-whx-bg p-6 text-whx-text">
    <h1 className="text-xl">Padrão de tabs Wharnex</h1>
    <section id="strip-owner" style={{ width: 800 }} className="mt-4">
      <WorkbenchTabs label="Referência Git" value={tab} onChange={setTab} items={[
        { id: 'changes', label: 'Alterações', icon: 'edit', badge: 26 }, { id: 'history', label: 'Histórico', icon: 'git', badge: 50 },
        { id: 'contributors', label: 'Contribuidores', icon: 'agent' }, { id: 'branches', label: 'Branches', icon: 'bridge', badge: 9 },
        { id: 'settings', label: 'Definições', icon: 'settings' },
      ]}/>
    </section>
    <div id="agent-owner" className="mt-4 w-[600px]"><AgentSurfaceTabs singlePane chatSelected={chatSelected} inspectorTab={inspectorTab} conflict={false} onChat={() => setChatSelected(true)} onInspector={(tab) => { setInspectorTab(tab); setChatSelected(false) }} attention={() => []} tone={() => undefined} title={(_target, label) => label}/></div>
    <div id="resource-owner" className="mt-4 w-[800px]">
      <EditorTabs documents={['src/App.tsx', 'src/DocumentWithAVeryLongFilenameAndUnsavedChanges.tsx'].map((path) => ({ path, content: '', draft: path === file ? 'changed' : '', sha256: '', size: 0 }))} activePath={file} savingPaths={new Set()} gitByPath={new Map()} onSelect={setFile} onClose={() => {}} onSave={async () => true}/>
      <TerminalTabBar tabs={[{ id: 1, label: 'Terminal 1', terminalID: '', cwd: '.', history: '', viewportY: 0, status: 'connected' }]} activeID={1} editingLabel="" onSelect={() => {}} onBeginRename={() => {}} onEditingLabel={() => {}} onFinishRename={() => {}} onCancelRename={() => {}} onClose={() => {}}/>
    </div>
    <div id="conversation-owner" className="agent-chat-switcher mt-4" style={{ width: 600, height: 40 }}>
      <ChatTabs chats={[
        { id: 'first', sessionId: 'first', title: 'Conversa inicial', createdAt: '', updatedAt: '', chatgptUrl: 'https://chatgpt.com/c/owned' },
        { id: 'second', sessionId: 'second', title: 'Conversa seguinte com um título bastante extenso', createdAt: '', updatedAt: '' },
      ]} activeId={chatId} onSelect={setChatId} onArchive={() => {}}/>
    </div>
    <div id="projects-owner" className="multi-project-bar mt-4" style={{ width: 800 }}>
      <ProjectTabs projects={['/workspace/alpha', '/workspace/beta', '/workspace/project-with-a-very-long-title']} activeProject={project} composerTypingProject="/workspace/alpha" busy={false} projectWindowOpen={false} activeButtonRef={null}
        accentStyle={(path) => ({ '--project-hue': path.endsWith('alpha') ? 210 : 35 })} projectName={(path) => path.split('/').at(-1) || path}
        onActiveMenu={() => {}} onActivate={setProject} onUnbind={() => {}}/>
    </div>
    <div className="mt-6 flex items-start gap-6">
      <div id="browser-owner" style={{ width: 360 }}><BrowserMonitorList agents={[]} selectedId="" onSelect={() => {}} selectedLinkKey="" onSelectLink={() => {}} onInstancesView={() => {}} expanded onToggle={() => {}}/></div>
      <div id="lab-owner" style={{ width: 560, height: 580 }}><UITestingPanel session={{ id: 'tabs-fixture' } as Session} onError={(message) => { throw new Error(message) }}/></div>
    </div>
  </main>
}
