import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ChatPanelProps } from '../../chat/panel/ChatPanel'
import { AgentChatSurface } from './AgentChatSurface'
import { session } from './testing/fixtures'

vi.mock('../../chat/panel/ChatPanel', () => ({ ChatPanel: ({ executionApproval }: ChatPanelProps) => <div aria-label="Chat">{executionApproval}</div> }))
afterEach(cleanup)
const current = session()
current.plan!.document = 'Contrato completo'
const chatProps = { session: current, items: [], chats: [{ id: 'chat-own', sessionId: current.id, title: 'Own', createdAt: '', updatedAt: '' }], archivedChats: [], activeChatId: 'chat-own', busy: false, onSend: vi.fn(), onNewChat: vi.fn(), onSelectChat: vi.fn(), onArchiveChat: vi.fn(), onRestoreChat: vi.fn(), onDeleteArchivedChat: vi.fn() }
const inspectorProps = { session: current, busy: false, events: [], manualPrompt: '', onChatGPTURL: () => true, onExecute: vi.fn(async () => undefined), onManualPlan: vi.fn(), onPlanFile: vi.fn(), onBundleFile: vi.fn(), onSession: vi.fn() }

it('composes informed approval into Chat using the Inspector execution handler', () => {
  render(<AgentChatSurface chatProps={chatProps} inspectorProps={inspectorProps} panelRef={null} viewportStore={new Map()}/>)
  fireEvent.click(screen.getByRole('button', { name: 'Aceitar e executar no chat' }))
  expect(inspectorProps.onExecute).toHaveBeenCalledWith(true, '')
})

it('does not attach the outgoing session approval to a newly selected chat', () => {
  render(<AgentChatSurface chatProps={{ ...chatProps, activeChatId: 'chat-other' }} inspectorProps={inspectorProps} panelRef={null} viewportStore={new Map()}/>)
  expect(screen.queryByLabelText('Aprovação de execução no chat')).toBeNull()
})
