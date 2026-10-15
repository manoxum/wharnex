import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChatPanel } from '../../chat/panel/ChatPanel'
import { panelRef, typeInComposer, session, chatActions } from '../../chat/panel/testing/panelTestFixtures'

afterEach(cleanup)
it.each([{ ctrlKey: true }, { metaKey: true }])('Ctrl/Cmd+Enter sends an immediate incremental comment to Codex while Enter still queues the next request: %j', async (modifier) => {
  const ref = panelRef(), comment = vi.fn().mockResolvedValue(undefined), send = vi.fn().mockResolvedValue(undefined)
  const view = render(<ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="chat" engine="codex" busy={false} taskInFlight onComment={comment} onSend={send} {...chatActions}/>)
  const editor = view.container.querySelector('.composer-rich-editor')!
  typeInComposer(ref, 'Inclua o teste incremental.', 26)
  fireEvent.keyDown(editor, { key: 'Enter', ...modifier })
  await waitFor(() => expect(comment).toHaveBeenCalledWith('Inclua o teste incremental.', []))
  expect(send).not.toHaveBeenCalled()
  typeInComposer(ref, 'Próximo pedido.', 15)
  fireEvent.keyDown(editor, { key: 'Enter' })
  await waitFor(() => expect(send).toHaveBeenCalled())
  expect(comment).toHaveBeenCalledTimes(1)
})
