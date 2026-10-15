import { useEffect, useState } from 'react'
import { useNativeActivity } from '../../src/lib/codex'
import { collectNativeAttentionItems } from '../../src/lib/attention'
import { useCompletionNotifications } from '../../src/app/attention'
import { newWorkspaceChat } from '../../src/lib/chat/history/workspaceMemory'

const projectPath = '/workspace/wharnex'
const chats = [{ ...newWorkspaceChat('fixture', 'Chat em segundo plano', 'chat-parser'), engine: 'codex' as const }]
const retainTranscript = () => undefined

export function CompletionObserver() {
  const [notices, setNotices] = useState<DesktopCompletionNotification[]>([])
  const threads = useNativeActivity(projectPath, chats, retainTranscript)
  useEffect(() => {
    const onNotice = (event: Event) => setNotices((current) => [...current, (event as CustomEvent<DesktopCompletionNotification>).detail])
    window.addEventListener('wharnex:fixture-completion', onNotice)
    return () => window.removeEventListener('wharnex:fixture-completion', onNotice)
  }, [])
  useCompletionNotifications(projectPath, collectNativeAttentionItems(projectPath, chats, threads))
  return <output aria-label="Notificações de conclusão" data-chat-id={notices.at(-1)?.chatId} className="block px-5 py-2 text-sm">{notices.length} · {notices.at(-1)?.title || 'A aguardar conclusão'}</output>
}
