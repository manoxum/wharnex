import type { ComponentProps } from 'react'
import type { EvolutionKnowledgeRef, HarnessEvent, ProjectTodo, Session, TerminalRunInput } from '../../../../types'
import type { ChatPanel } from '../../../chat/panel/ChatPanel'
import type { AttentionItem } from '../../../../lib/attention/center/attentionCenter'
import type { ExecutionFIFOItem } from '../../../../lib/execution/history/executionQueueView'
import type { WorkspaceRailSide, WorkspaceTool } from '../../../../lib/workspace/layout/workspaceRailLayout'
import type { Drawer } from '../../../../lib/workspace/layout/workspaceDrawer'

export type WorkspaceSideRailProps = {
  session: Session
  busy: boolean
  drawer: Drawer
  onDrawer: (next: Drawer) => void
  chats: ComponentProps<typeof ChatPanel>['chats']
  chatProps?: ComponentProps<typeof ChatPanel>
  savedChats?: ComponentProps<typeof ChatPanel>['archivedChats']
  archivedChats: ComponentProps<typeof ChatPanel>['archivedChats']
  activeChatId: string
  activeEvents: HarnessEvent[]
  attentionItems: AttentionItem[]
  attentionHistoryItems?: AttentionItem[]
  executionFIFO: ExecutionFIFOItem[]
  activeExecutionCount: number
  onOpenAttention: (item: AttentionItem) => Promise<void>
  onAttentionAction: (item: AttentionItem) => Promise<void>
  onRestoreSavedChat?: (chatId: string) => Promise<void>
  onArchiveSavedChat?: (chatId: string) => Promise<void>
  onRestoreChat: ComponentProps<typeof ChatPanel>['onRestoreChat']
  onDeleteArchivedChat: ComponentProps<typeof ChatPanel>['onDeleteArchivedChat']
  onRenameChat: ComponentProps<typeof ChatPanel>['onRenameChat']
  onGenerateChatTitle: ComponentProps<typeof ChatPanel>['onGenerateChatTitle']
  onOpenFile: (path: string) => void
  explorerRevealPath?: string
  explorerRevealNonce?: number
  onAnalyzeEvolution?: (ids: string[], knowledgeRefs?: EvolutionKnowledgeRef[], files?: File[], knowledgeOnly?: boolean) => Promise<void>
  onConsolidateKnowledge?: () => Promise<void>
  onError: (message: string) => void
  onSession?: (session: Session) => void
  onResolveConflictWithGPT?: (session: Session) => Promise<void>
  onOpenGitConflictChat?: (session: Session) => Promise<void>
  terminalOpen: boolean
  onToggleTerminal: () => void
  onRunInTerminal?: (input: TerminalRunInput) => void
  onGoToChat?: (chatId?: string, sessionId?: string) => void
  onGoToOrchestrator?: () => void
  onPromoteTodoToChat?: (todo: ProjectTodo) => Promise<void>
  onPromoteTodoToCurrentChat?: (todo: ProjectTodo) => Promise<void>
  onLocateTodoChat?: (chatId: string) => void
  onFollowInstance?: (agentId: string, chatId?: string, sessionId?: string) => void
  onFocusProject?: (projectPath: string) => void
  side?: WorkspaceRailSide
  tools?: WorkspaceTool[]
  pinnedTools?: WorkspaceTool[]
  onMoveTool?: (tool: WorkspaceTool, side: WorkspaceRailSide, before?: WorkspaceTool, pinned?: boolean) => void
  drawerWidth?: number
  onDrawerWidth?: (width: number) => void
}
