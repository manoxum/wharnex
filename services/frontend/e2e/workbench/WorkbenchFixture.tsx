import { useState } from 'react'
import { WorkspaceSideRail, WorkspaceTopbar, WorkbenchStatusBar, WorkbenchCommandCenter, useWorkbenchLayout, workbenchPresentation, OperationalWorkbench } from '../../src/components/workspace'
import { DeferredEditorWorkspace } from '../../src/components/editor'
import { ChatPanel } from '../../src/components/chat/panel/ChatPanel'
import { ProjectSettings } from '../../src/components/project/settings/ProjectSettings'
import { OrchestratorWorkspace } from '../../src/components/orchestrator'
import { createCodexComposerControls, type PlannerChatConfiguration } from '../../src/lib/codex'
import { projectPath, session } from './catalog'
import type { ChatItem, WorkspaceMode } from '../../src/types'

const nothing = async () => {}
const chats = [{ id: 'chat-fixture', sessionId: session.id, title: 'Rever o projeto Atlas', createdAt: session.created_at, updatedAt: session.created_at }]
export function WorkbenchFixture() {
  const layout = useWorkbenchLayout(projectPath, projectPath)
  const [mode, setMode] = useState<WorkspaceMode>(new URLSearchParams(location.search).get('workspace') === 'orchestrator' ? 'orchestrator' : 'editor')
  const [settings, setSettings] = useState(false)
  const [path, setPath] = useState('src/app.ts')
  const [openNonce, setOpenNonce] = useState(1)
  const [error, setError] = useState('')
  const [items, setItems] = useState<ChatItem[]>([])
  const [chat, setChat] = useState<PlannerChatConfiguration>({ engine: 'chatgpt' })
  const controls = createCodexComposerControls(chat, false, false, (patch) => setChat((current) => ({ ...current, ...patch })))
  const openFile = (next: string) => { setPath(next); setOpenNonce((value) => value + 1); setMode('editor') }
  const rail = { session, busy: false, chats, savedChats: [], archivedChats: [], activeChatId: 'chat-fixture', activeEvents: [], attentionItems: [], executionFIFO: [], activeExecutionCount: 0, onOpenAttention: nothing, onAttentionAction: nothing, onRestoreChat: nothing, onDeleteArchivedChat: nothing, onOpenFile: openFile, onError: setError, terminalOpen: layout.terminalOpen, onToggleTerminal: layout.toggleTerminal }
  return <main className={workbenchPresentation(layout.focusMode, layout.zenMode)}>
    <WorkspaceTopbar session={session} mode={mode} executionMode="protected" automationMode="manual" busy={false} onMode={setMode} onSettings={() => setSettings(true)} onClose={() => {}}/>
    <WorkbenchCommandCenter zenMode={layout.zenMode} onZen={() => layout.setZenMode((value) => !value)} session={session} onMode={setMode} onTool={(tool) => { layout.setZenMode(false); layout.setFocusMode(false); layout.setSideDrawer(tool) }} onOpenFile={openFile} onSettings={() => setSettings(true)} onTerminal={layout.toggleTerminal} onFocus={() => layout.setFocusMode((focus) => !focus)} onRestore={layout.restoreLayout}/>
    <div className="workspace-body">
      <div className="workspace-main-row @container/workbench !relative">
        <WorkspaceSideRail {...rail} drawer={layout.sideDrawer} onDrawer={layout.setSideDrawer} side="left" tools={layout.railLayout.left} pinnedTools={layout.railLayout.pinned.left} drawerWidth={layout.leftDrawerWidth} onDrawerWidth={layout.setLeftDrawerWidth}/>
        <div className="workspace-center-column">
          <div className={mode === 'editor' ? 'flex min-h-0 flex-1' : 'hidden'}><DeferredEditorWorkspace session={session} active={mode === 'editor'} openPath={path} openNonce={openNonce} onError={setError} onRunInTerminal={() => {}}/></div>
          <div className={mode === 'agent' ? 'flex min-h-0 flex-1' : 'hidden'}><ChatPanel session={session} chats={chats} activeChatId="chat-fixture" items={items} busy={false} hideSwitcher attachmentsEnabled {...controls} onSend={async (text) => setItems((current) => [...current, { id: String(current.length), role: 'user', text, createdAt: new Date().toISOString() }])} onNewChat={nothing} onSelectChat={nothing} onArchiveChat={nothing} onRestoreChat={nothing} onDeleteArchivedChat={nothing}/></div>
          {mode === 'orchestrator' && <OrchestratorWorkspace session={session} chats={chats} active onError={(message) => setError(message || '')} chatProps={{ session, chats, activeChatId: 'chat-fixture', items: [], busy: false, ...controls, onSend: nothing, onNewChat: nothing, onSelectChat: nothing, onArchiveChat: nothing }}/>}

        </div>
        <WorkspaceSideRail {...rail} drawer={layout.rightDrawer} onDrawer={layout.setRightDrawer} side="right" tools={layout.railLayout.right} pinnedTools={layout.railLayout.pinned.right} drawerWidth={layout.rightDrawerWidth} onDrawerWidth={layout.setRightDrawerWidth}/>
      </div>
      <OperationalWorkbench session={session} chats={chats} activeChatId="chat-fixture" events={[]} visible={layout.terminalOpen} height={layout.terminalHeight} terminalActivation={layout.terminalActivation} onHeight={layout.setTerminalHeight} onOpen={() => layout.setTerminalOpen(true)} onClose={() => layout.setTerminalOpen(false)} terminal={(active) => <section data-testid="fixture-terminal" data-active={active} className="terminal-workspace h-full bg-whx-bg p-4 font-mono text-whx-label text-whx-soft" aria-label="Sessão de terminal da fixture"><span>Terminal · fixture sem acesso ao host</span><span className="mt-3 block">atlas $</span></section>}/>
      <WorkbenchStatusBar mode={mode} executionMode="protected" automationMode="manual" terminalOpen={layout.terminalOpen} activeExecutions={0} layout={{ leftOpen: Boolean(layout.sideDrawer), rightOpen: Boolean(layout.rightDrawer), terminalOpen: layout.terminalOpen, focusMode: layout.focusMode, onLeft: layout.toggleLeft, onRight: layout.toggleRight, onTerminal: layout.toggleTerminal, onFocus: () => layout.setFocusMode((focus) => !focus), onRestore: layout.restoreLayout }}/>
    </div>
    {settings && <ProjectSettings session={session} onClose={() => setSettings(false)} onError={setError}/>}
    {error && <p role="alert" className="fixed bottom-12 left-14 rounded bg-whx-surface p-3 text-whx-label text-whx-warning">{error}</p>}
  </main>
}
