import { describe, expect, it } from 'vitest'
import { createPlanProposalActions } from './proposals'
import type { ChatItem } from '../../../types'
import type { WorkspaceChat } from '../../../lib/chat'

function fixture(approve: () => Promise<unknown>) {
  const events: string[] = []
  const item: ChatItem = { id: 'plan-1', role: 'harness', text: 'plan', approval: { status: 'pending', requestId: 'req-1' } }
  let items = [item]
  const session = { id: 'session-1', project_path: '/project', last_manual_prompt: '', last_request_id: 'req-1' }
  const chat = { id: 'chat-1', chatgptUrl: 'https://chatgpt.com/c/1' }
  const actions = createPlanProposalActions({
    planAPI: {
      approvePlan: approve,
      correctPlan: async () => { throw new Error('unused') },
      rejectPlan: async () => session,
    },
    session, chats: [chat], activeChatId: 'chat-1', activeChatIdRef: { current: 'chat-1' },
    setBusy: (value: boolean) => events.push(`busy:${value}`),
    setError: (value: string | undefined) => { if (value) events.push(`error:${value}`) },
    acceptSessionForChat: () => events.push('session'),
    setManualPrompt: () => events.push('prompt'),
    mutateChatItems: (_chat: WorkspaceChat, _project: string, mutate: (items: ChatItem[]) => ChatItem[]) => { items = mutate(items) },
    updateChat: () => events.push('chat'),
    transportPlannerContinuation: async () => ({ submitted: false }),
    appendChatItem: (_chat: WorkspaceChat, _project: string, notice: ChatItem) => events.push(`notice:${notice.meta}`),
  } as unknown as Parameters<typeof createPlanProposalActions>[0])
  return { actions, events, item, items: () => items, session }
}

describe('plan proposal actions', () => {
  it('records a successful approval and prepares a manual continuation notice', async () => {
    const result = { session: { id: 'session-1', project_path: '/project', last_manual_prompt: '' }, manual_prompt: '' }
    const { actions, events, item, items } = fixture(async () => result)
    await actions.approvePlanProposal(item)
    expect(items()[0].approval?.status).toBe('approved')
    expect(events).toContain('notice:Plan approval · envio manual')
    expect(events.at(-1)).toBe('busy:false')
  })

  it('keeps a pending proposal available when approval fails', async () => {
    const { actions, events, item, items } = fixture(async () => { throw new Error('backend unavailable') })
    await actions.approvePlanProposal(item)
    expect(items()[0].approval?.status).toBe('pending')
    expect(events).toContain('error:backend unavailable')
    expect(events.at(-1)).toBe('busy:false')
  })
})
