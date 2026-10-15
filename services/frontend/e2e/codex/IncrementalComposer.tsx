import { useState } from 'react'
import { ChatPanel } from '../../src/components/chat/panel/ChatPanel'
import { sendTaskComment } from '../../src/app/chat/comments'
import { useCodexStatus } from '../../src/lib/codex'
import { desktopBridge } from '../../src/lib/desktop/bridge/desktop'
import type { ChatItem, Session } from '../../src/types'
import type { WorkspaceChat } from '../../src/lib/chat/history/workspaceMemory'

const session: Session = { id: 'fixture-session', project_path: '/workspace/wharnex', state: 'ready', execution_mode: 'protected', automation_mode: 'manual', created_at: '',
  context: { id: 'context', manifest: { id: 'context', project_root: '/workspace/wharnex', sha256: '', files: [], excluded: [], text_truncated: false } } }
const chat: WorkspaceChat = { id: 'chat-parser', sessionId: session.id, title: 'Native', engine: 'codex', createdAt: '', updatedAt: '' }

export function IncrementalComposer() {
  const [items, setItems] = useState<ChatItem[]>([]), [queued, setQueued] = useState(0)
  const status = useCodexStatus(session.project_path)
  const thread = status.threads?.find((entry) => entry.chatId === chat.id)
  return <div className="flex min-h-0 flex-1 flex-col">
    <output aria-label="Pedidos em fila">{queued}</output>
    <ChatPanel session={session} items={items} chats={[chat]} activeChatId={chat.id} engine="codex" busy={false} composerOnly
      taskInFlight={Boolean(thread && ['running', 'waiting'].includes(thread.status))}
      onSend={async () => { setQueued((count) => count + 1) }}
      onComment={async (text, files) => {
        const bridge = desktopBridge()
        if (!bridge) throw new Error('Bridge indisponível.')
        const item = await sendTaskComment(bridge, session, chat, thread, text, files)
        setItems((current) => [...current, item])
      }}/>
  </div>
}
