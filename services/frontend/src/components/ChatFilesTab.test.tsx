import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Session } from '../types'
import { ChatPanel } from './ChatPanel'

const session = {
  id: 'ses-chat-files',
  project_path: '/tmp/demo',
  state: 'ready',
  execution_mode: 'protected',
  automation_mode: 'manual',
  created_at: new Date().toISOString(),
  context: {
    id: 'ctx-chat-files',
    manifest: { id: 'ctx-chat-files', project_root: '/tmp/demo', sha256: 'abcdef1234567890', files: [], excluded: [], text_truncated: false },
  },
} satisfies Session

const chatActions = {
  archivedChats: [],
  onNewChat: async () => undefined,
  onSelectChat: async () => undefined,
  onArchiveChat: async () => undefined,
  onRestoreChat: async () => undefined,
  onDeleteArchivedChat: async () => undefined,
}

describe('ChatPanel files tab', () => {
  afterEach(cleanup)

  it('switches from the conversation to the chat bundle and artifact library', () => {
    render(<ChatPanel session={session} items={[{ id: 'message-1', role: 'user', text: 'Olá' }]} chats={[]} activeChatId="chat-files" busy={false} onSend={async () => undefined} {...chatActions} />)

    expect(screen.getByRole('tab', { name: 'Conversa' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: 'Ficheiros' }))

    expect(screen.getByRole('tab', { name: 'Ficheiros' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('region', { name: 'Ficheiros e bundles do chat' })).toBeTruthy()
    expect(screen.getByText('Nenhum bundle trocado neste chat.')).toBeTruthy()
    expect(screen.queryByText('Olá')).toBeNull()
  })
})
