import { lazy } from 'react'
import type { Drawer } from '../../../../lib/workspace/layout/workspaceDrawer'
import type { WorkspaceSideRailProps } from './panelTypes'
import { AttentionCenterDrawer } from './AttentionCenterDrawer'
import { ChatManagementDrawer } from '../../../chat/panel/ChatManagementDrawer'
import { Icon } from '../../../presentation/chrome/Icon'

const AgentProjectExplorer = lazy(() => import('../../../agent/explorer/AgentProjectExplorer').then((m) => ({ default: m.AgentProjectExplorer })))
const ExecutionErrorsDrawer = lazy(() => import('../../../execution/history/ExecutionErrorsDrawer').then((m) => ({ default: m.ExecutionErrorsDrawer })))
const EvolutionEvidenceDrawer = lazy(() => import('../../../project/knowledge/EvolutionEvidenceDrawer').then((m) => ({ default: m.EvolutionEvidenceDrawer })))
const ProjectKnowledgeDrawer = lazy(() => import('../../../project/knowledge/ProjectKnowledgeDrawer').then((m) => ({ default: m.ProjectKnowledgeDrawer })))
const GitDrawer = lazy(() => import('../../../git/review/GitDrawer').then((m) => ({ default: m.GitDrawer })))
const AgentRuntimeDrawer = lazy(() => import('../../../agent/runtime/AgentRuntimeDrawer').then((m) => ({ default: m.AgentRuntimeDrawer })))
const CodexPanel = lazy(() => import('../../../codex/surface').then((m) => ({ default: m.CodexPanel })))
const ProjectTasksDrawer = lazy(() => import('../../../project/tasks/ProjectTasksDrawer').then((m) => ({ default: m.ProjectTasksDrawer })))
const ArtifactExplorerPanel = lazy(() => import('../../../artifacts/explorer/ArtifactExplorerPanel').then((m) => ({ default: m.ArtifactExplorerPanel })))
const DatabaseExplorerPanel = lazy(() => import('../../../database/browser/DatabaseExplorerPanel').then((m) => ({ default: m.DatabaseExplorerPanel })))
const ProjectTodoPanel = lazy(() => import('../../../project/tasks/ProjectTodoPanel').then((m) => ({ default: m.ProjectTodoPanel })))
const DockerServicesPanel = lazy(() => import('../../../docker/services/DockerServicesPanel').then((m) => ({ default: m.DockerServicesPanel })))
const UITestingPanel = lazy(() => import('../../../project/ui-testing/UITestingPanel').then((m) => ({ default: m.UITestingPanel })))


export function WorkspaceDrawerContent({ candidate, close, props }: { candidate: Exclude<Drawer, ''>; close: () => void; props: WorkspaceSideRailProps }) {
  const { session, busy, attentionItems, executionFIFO, onError, archivedChats } = props
  const attentionHistoryItems = props.attentionHistoryItems || []
  const savedChats = props.savedChats || []
  return <>
        {candidate === 'attention' ? <AttentionCenterDrawer items={attentionItems} historyItems={attentionHistoryItems} activeChatId={props.activeChatId} busy={busy} onOpen={props.onOpenAttention} onAction={props.onAttentionAction} onClose={close}/> : null}
        {candidate === 'todo' && props.chatProps ? <ProjectTodoPanel session={session} chatProps={props.chatProps} onClose={close} onPromoteToChat={props.onPromoteTodoToChat} onPromoteToCurrentChat={props.onPromoteTodoToCurrentChat} onLocateChat={props.onLocateTodoChat} onGoToOrchestrator={props.onGoToOrchestrator} onError={onError}/> : null}
        {candidate === 'archive' ? <ChatManagementDrawer projectPath={session.project_path} savedChats={savedChats} archivedChats={archivedChats} busy={busy} onRestoreSaved={props.onRestoreSavedChat} onArchiveSaved={props.onArchiveSavedChat} onRestoreArchived={props.onRestoreChat} onDeleteArchived={props.onDeleteArchivedChat} onRename={props.onRenameChat} onGenerate={props.onGenerateChatTitle} onClose={close}/> : null}
        {candidate === 'project' ? <AgentProjectExplorer session={session} onOpen={props.onOpenFile} onError={onError} onClose={close} revealPath={props.explorerRevealPath} revealNonce={props.explorerRevealNonce}/> : null}
        {candidate === 'library' ? <ArtifactExplorerPanel sessionId={session.id} onError={onError} onClose={close}/> : null}
        {candidate === 'knowledge' ? <ProjectKnowledgeDrawer session={session} busy={busy} onConsolidate={props.onConsolidateKnowledge} onClose={close}/> : null}
        {candidate === 'git' ? <GitDrawer session={session} busy={busy} onClose={close} onError={onError} onSession={props.onSession} onResolveConflictWithGPT={props.onResolveConflictWithGPT} onOpenGitConflictChat={props.onOpenGitConflictChat}/> : null}
        {candidate === 'agents' ? <AgentRuntimeDrawer projectPath={session.project_path} chats={props.chats} onGoToChat={props.onGoToChat} onFocusProject={props.onFocusProject} onClose={close} onError={onError}/> : null}
        {candidate === 'external-agents' ? <CodexPanel projectPath={session.project_path} chatId={props.chatProps?.activeChatId} onSelectChat={props.chatProps?.onSelectChat}/> : null}
        {candidate === 'tasks' ? <ProjectTasksDrawer projectPath={session.project_path} currentSession={session} chats={props.chats} savedChats={savedChats} archivedChats={archivedChats} activeChatId={props.activeChatId} activeEvents={props.activeEvents} executionFIFO={executionFIFO} onClose={close} onError={onError} onGoToChat={props.onGoToChat}/> : null}
        {candidate === 'errors' ? <ExecutionErrorsDrawer chats={[...props.chats, ...savedChats, ...archivedChats]} currentSession={session} activeChatId={props.activeChatId} onClose={close}/> : null}
        {candidate === 'evolution' && session.self_evolution ? <EvolutionEvidenceDrawer session={session} busy={busy} onAnalyze={props.onAnalyzeEvolution || (async () => undefined)} onClose={close}/> : null}
        {candidate === 'database' ? <div className="workspace-database-drawer"><DatabaseExplorerPanel onError={onError}/><button type="button" className="workspace-right-close" onClick={close} aria-label="Fechar painel lateral direito"><Icon name="close" size={12}/></button></div> : null}
        {candidate === 'ui-testing' ? <UITestingPanel session={session} onError={onError} onClose={close}/> : null}
        {candidate === 'docker' ? <DockerServicesPanel session={session} onError={onError} onClose={close} onRunInTerminal={props.onRunInTerminal}/> : null}
  </>
}
