import { vi } from 'vitest'
import type { Session } from '../../../../types'
import { useEffect, useState, type ComponentProps } from 'react'
import { AgentWorkspace } from '.././AgentWorkspace'
import { WorkspaceSideRail, type Drawer, type WorkspaceSideRailProps } from '../../../workspace/shell/WorkspaceSideRail'
import { collectAttentionItems, type AttentionItem, type AttentionTarget } from '../../../../lib/attention/center/attentionCenter'
import { executionQueueActiveCount, type ExecutionFIFOItem } from '../../../../lib/execution/history/executionQueueView'


// Monaco has no usable DOM/worker environment under jsdom, so the stub exposes
// the edit/save contract that the Agent file modal wires into the real editor.
vi.mock('../../../editor/canvas/CodeEditor', () => ({ CodeEditor: ({ path, value, onChange, onSave }: { path: string; value: string; onChange: (value: string) => void; onSave: () => void }) => <div data-testid="code-editor-stub"><textarea aria-label={`Editor de ${path}`} value={value} onChange={(event) => onChange(event.target.value)}/><button type="button" onClick={onSave}>Guardar no editor</button></div> }))

export function session(): Session {
  return {
    id: 'ses-agent', project_path: '/workspace/wharnex', state: 'planned', execution_mode: 'protected', automation_mode: 'auto', created_at: new Date().toISOString(),
    context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/wharnex', sha256: 'abcdef123456', files: [], excluded: [], text_truncated: false } },
    plan: { protocol: 'harness.execution/v1', plan_id: 'plan-agent', request_id: 'req-agent', status: 'ready', summary: 'Atualizar UI', risk: 'low', requires_approval: false, operations: [], verification: [] },
    policy: { allowed: true, requires_approval: false, risk: 'low', reasons: [] },
  }
}

// The rail and the Agent workspace are siblings under the shell, so the harness
// mirrors that: it owns the drawer and the attention handlers the shell owns,
// which is what lets these tests exercise the rail and the workspace together.
export function props(current = session(), human: { notice?: DesktopChatGPTHumanAction; nonce?: number; onAction?: () => void } = {}, busy = false) {
  const onExecute = vi.fn(async (approve?: boolean) => { void approve })
  const onRetryDependencyNetwork = vi.fn(async () => undefined)
  const onRetryHostDependencyRepair = vi.fn(async () => undefined)
  const onApply = vi.fn(async () => undefined)
  const onRestore = vi.fn(async () => undefined)
  const onDelete = vi.fn(async () => undefined)
  const onOpenFile = vi.fn()
  const onExportChat = vi.fn(async () => undefined)
  const onSelectChat = vi.fn(async (chatId: string) => { void chatId })
  const onReorderChat = vi.fn()
  const chats = [
    { id: 'chat-1', title: 'Principal', sessionId: current.id, createdAt: '2026-09-04T10:00:00.000Z', updatedAt: '2026-09-04T10:00:00.000Z' },
    { id: 'chat-2', title: 'Paralelo', sessionId: 'ses-parallel', createdAt: '2026-09-04T09:00:00.000Z', updatedAt: '2026-09-04T09:00:00.000Z' },
  ]
  const archivedChats = [{ id: 'arch-1', title: 'Diagnóstico antigo', sessionId: 'ses-old', createdAt: '2026-09-03T10:00:00.000Z', updatedAt: '2026-09-03T11:00:00.000Z' }]

  function Harness({ session: active = current, attentionSessions = {}, chatgptHumanActions = {}, nonce = human.nonce, recoveryTab, chatProps: chatOverride, inspectorProps: inspectorOverride, workspaceProps = {}, executionFIFO = [], railVisible = false, singlePane = false }: {
    session?: Session
    attentionSessions?: Record<string, Session | undefined>
    chatgptHumanActions?: Record<string, DesktopChatGPTHumanAction>
    nonce?: number
    recoveryTab?: AttentionTarget
    chatProps?: Record<string, unknown>
    inspectorProps?: Record<string, unknown>
    workspaceProps?: Partial<Pick<ComponentProps<typeof AgentWorkspace>, 'onDetachChat' | 'onSplitChat' | 'minimalSurface'>>
    executionFIFO?: ExecutionFIFOItem[]
    railVisible?: boolean
    singlePane?: boolean
  }) {
    const [drawer, setDrawer] = useState<Drawer>('')
    const [inspectorAttention, setInspectorAttention] = useState<{ tab: AttentionTarget; nonce: number }>({ tab: 'terminal', nonce: 0 })
    const [terminalOpen, setTerminalOpen] = useState(false)
    // An external recovery action routes the inspector through the same channel
    // the shell uses, so the workspace sees exactly what production sends it.
    useEffect(() => {
      if (!recoveryTab) return
      setInspectorAttention((value) => ({ tab: recoveryTab, nonce: value.nonce + 1 }))
    }, [recoveryTab])
    const attentionItems = collectAttentionItems(chats, attentionSessions, chatgptHumanActions)
    const openAttention = async (item: AttentionItem) => {
      if (item.id.endsWith(':chatgpt-human-action') && human.notice?.active && human.onAction) { human.onAction(); return }
      if (item.chatId !== (chatOverride?.activeChatId ?? 'chat-1')) await onSelectChat(item.chatId)
      if (item.target) setInspectorAttention((value) => ({ tab: item.target as AttentionTarget, nonce: value.nonce + 1 }))
    }
    // Mirrors the shell's own handler, including the cross-chat rule: an action
    // for another chat first navigates there instead of acting on this one.
    const runAttention = async (item: AttentionItem) => {
      if (!item.action) return
      if (item.chatId !== (chatOverride?.activeChatId ?? 'chat-1')) { await openAttention(item); return }
      if (item.action === 'approve-execution') await onExecute(true)
      else if (item.action === 'retry-dependency-network') await onRetryDependencyNetwork()
      else if (item.action === 'repair-host-dependency') await onRetryHostDependencyRepair()
      else if (item.action === 'retry-transport') await (chatOverride?.onRetryTransportFailure as ((id: string) => Promise<void>) | undefined)?.(item.requestId || '')
      else if (item.action === 'retry-host-apply') await onApply()
    }
    const sharedRailProps = {
      session: active, busy, chats, archivedChats, activeChatId: 'chat-1', activeEvents: [],
      attentionItems, executionFIFO, activeExecutionCount: executionQueueActiveCount(executionFIFO),
      onOpenAttention: openAttention, onAttentionAction: runAttention, onRestoreChat: onRestore, onDeleteArchivedChat: onDelete,
      onRenameChat: async () => undefined, onGenerateChatTitle: async () => undefined, onOpenFile, onError: vi.fn(),
      terminalOpen, onToggleTerminal: () => setTerminalOpen((open) => !open),
    } satisfies Omit<WorkspaceSideRailProps, 'drawer' | 'onDrawer'>
    return <div className="workspace-body">
      <div className="workspace-main-row">
        <WorkspaceSideRail {...sharedRailProps} drawer={drawer} onDrawer={setDrawer}/>
        <div className="workspace-center-column">
          <div className="workspace-mode-stack">
            <AgentWorkspace
            session={active}
            busy={busy}
            attentionItems={attentionItems}
            chatgptAttentionNonce={nonce}
            inspectorAttention={inspectorAttention}
            singlePane={singlePane}
            onOpenAttention={openAttention}
            onAttentionAction={runAttention}
            onOpenAttentionDrawer={() => setDrawer('attention')}
            railVisible={railVisible}
            onExportChat={onExportChat}
            onReorderChat={onReorderChat}
            {...workspaceProps}
            chatProps={{
              session: active, items: [], chats, archivedChats, activeChatId: 'chat-1', busy,
              onSend: async () => undefined, onNewChat: async () => undefined, onSelectChat, onArchiveChat: async () => undefined, onRestoreChat: onRestore, onDeleteArchivedChat: onDelete,
              ...chatOverride,
            } as ComponentProps<typeof AgentWorkspace>['chatProps']}
            inspectorProps={{
              config: { planner: 'openai', sandbox: 'docker', model: 'test', api_configured: true, chatgpt_web_embed: false }, session: active, events: [], manualPrompt: '', busy,
              onChatGPTURL: () => true, onExecute, onRetryDependencyNetwork, onRetryHostDependencyRepair, onRejectPendingChanges: async () => undefined, onManualPlan: async () => undefined, onPlanFile: async () => '', onBundleFile: async () => '', onSession: () => undefined,
              ...inspectorOverride,
            } as ComponentProps<typeof AgentWorkspace>['inspectorProps']}
            />
          </div>
        </div>
        {railVisible && <WorkspaceSideRail {...sharedRailProps} side="right" tools={['project', 'database']} drawer="" onDrawer={() => undefined}/>}
      </div>
    </div>
  }

  return {
    onExecute, onRetryDependencyNetwork, onRetryHostDependencyRepair, onApply, onRestore, onDelete, onOpenFile, onExportChat, onSelectChat, onReorderChat,
    Harness,
    element: <Harness />,
  }
}
