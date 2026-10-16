import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import type { HarnessEvent, Session } from '../../../../types'
import type { WorkspaceChat } from '../../../../lib/chat/history/workspaceMemory'
import { WorkbenchTabs } from '../../../presentation/tabs'
import { IconButton } from '../../../presentation/workbench'
import { ContentSkeleton } from '../../../presentation/chrome/Skeleton'
import { useOperationalTab } from './useOperationalTab'
import { useUtilityPanel } from './useUtilityPanel'

const Problems = lazy(() => import('../../../execution/history/ExecutionErrorsDrawer').then((module) => ({ default: module.ExecutionErrorsDrawer })))
const Output = lazy(() => import('./OperationalOutput').then((module) => ({ default: module.OperationalOutput })))

export function OperationalWorkbench({ session, chats, activeChatId, events, visible, height, onHeight, onOpen, onClose, runRequestId, terminalActivation, terminal }: {
  session: Session; chats: WorkspaceChat[]; activeChatId: string; events: HarnessEvent[]
  visible: boolean; height: number; onHeight: (height: number) => void; onOpen: () => void; onClose: () => void
  runRequestId?: number; terminalActivation?: number; terminal: (active: boolean) => ReactNode
}) {
  const { tab, select, visited } = useOperationalTab(session.project_path, runRequestId, terminalActivation)
  const [problemCount, setProblemCount] = useState<number | null>(null)
  useEffect(() => setProblemCount(null), [session.id])
  const panel = useUtilityPanel({ projectPath: session.project_path, visible, tab, problemCount, height, onHeight, onOpen, onClose })
  return <section ref={panel.root} aria-label="Ferramentas operacionais" data-expanded={panel.expanded} className="workbench-operational-panel relative flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden bg-whx-workspace" style={{ height: panel.panelHeight }}>
    {panel.expanded && <div role="separator" tabIndex={0} aria-orientation="horizontal" aria-label="Ajustar altura do painel inferior" aria-valuemin={panel.minimum} aria-valuemax={panel.maximum} aria-valuenow={Math.round(panel.panelHeight)}
      className="absolute inset-x-0 top-0 z-10 h-1.5 cursor-ns-resize touch-none bg-transparent transition-colors hover:bg-whx-accent/40 focus-visible:bg-whx-accent/40 focus-visible:outline-none motion-reduce:transition-none"
      onPointerDown={panel.beginResize} onDoubleClick={() => panel.resize(275)} onKeyDown={(event) => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        panel.resize(event.key === 'Home' ? panel.minimum : event.key === 'End' ? panel.maximum : panel.panelHeight + (event.key === 'ArrowUp' ? 16 : -16))
      }}/>}
    <div className="flex h-10 shrink-0 items-stretch justify-between bg-whx-side">
      <WorkbenchTabs label="Ferramentas operacionais" value={tab} onChange={(next) => { select(next); panel.expand() }} className="min-w-0 flex-1 !min-h-10 !border-b-0 !bg-transparent [&>[data-workbench-tab]]:!grow-0" items={[
        { id: 'terminal', label: 'Terminal', icon: 'terminal', domId: 'operational-terminal-tab', controls: 'operational-terminal-pane' },
        { id: 'problems', label: 'Problemas', icon: 'alert', badge: problemCount === null ? undefined : <span className={problemCount ? 'text-whx-danger' : 'font-normal text-whx-faint'}>{problemCount}</span>, domId: 'operational-problems-tab', controls: 'operational-problems-pane' },
        { id: 'output', label: 'Saída de execução', icon: 'list', domId: 'operational-output-tab', controls: 'operational-output-pane' },
      ]}/>
      <div className="flex shrink-0 items-center gap-1 px-1"><IconButton label={panel.maximized ? 'Restaurar painel inferior' : 'Ampliar painel inferior'} icon={panel.maximized ? 'collapse' : 'monitor'} aria-pressed={panel.maximized} onClick={panel.toggleMaximize}/>{panel.expanded && <IconButton label="Recolher ferramentas operacionais" icon="close" onClick={panel.collapse}/>}</div>
    </div>
    <div id="operational-terminal-pane" role="tabpanel" aria-labelledby="operational-terminal-tab" className={`min-h-0 flex-1 flex-col [&>.terminal-workspace]:!min-h-0 ${panel.expanded && tab === 'terminal' ? 'flex' : 'hidden'}`}>{terminal(panel.expanded && tab === 'terminal')}</div>
    {visited.has('problems') && <div id="operational-problems-pane" role="tabpanel" aria-labelledby="operational-problems-tab" className={`min-h-0 flex-1 flex-col ${panel.expanded && tab === 'problems' ? 'flex' : 'hidden'}`}><Suspense fallback={<ContentSkeleton label="A abrir problemas" rows={3}/>}><Problems chats={chats} currentSession={session} activeChatId={activeChatId} onClose={panel.collapse} onSummary={setProblemCount} embedded/></Suspense></div>}
    {visited.has('output') && <div id="operational-output-pane" role="tabpanel" aria-labelledby="operational-output-tab" className={`min-h-0 flex-1 overflow-y-auto ${panel.expanded && tab === 'output' ? 'block' : 'hidden'}`}><Suspense fallback={<ContentSkeleton label="A abrir saída" rows={3}/>}>
      <Output session={session} events={events} active={panel.expanded && tab === 'output'}/>
    </Suspense></div>}
  </section>
}
