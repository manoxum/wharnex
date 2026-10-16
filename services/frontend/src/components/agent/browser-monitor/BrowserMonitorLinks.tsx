import { useEffect, useState } from 'react'
import { api } from '../../../lib/transport/http/api'
import type { BrowserMonitorChat } from '../../../lib/transport/http/browser-monitor/catalog'
import { agentForChat } from './browserMonitorModel'

export function BrowserMonitorLinks({ agents, selectedKey, onSelect }: {
  agents: DesktopAgentRuntimeAgent[]; selectedKey: string; onSelect: (chat: BrowserMonitorChat) => void
}) {
  const [chats, setChats] = useState<BrowserMonitorChat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    const refresh = async () => {
      try {
        const result = await api.browserMonitorChats()
        if (alive) { setChats(result.chats || []); setError('') }
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : 'Não foi possível listar os chats.')
      } finally { if (alive) setLoading(false) }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 30_000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [])

  return <div aria-label="Chats com links GPT">
    {loading && <p className="px-2 py-3 text-whx-caption text-whx-faint" role="status">A carregar chats…</p>}
    {error && <p className="px-2 py-3 text-whx-caption text-whx-danger" role="alert">{error}</p>}
    {!loading && !error && !chats.length && <p className="rounded-xl border border-dashed border-whx-border-soft p-4 text-whx-label text-whx-faint">Nenhum chat criado tem um link GPT associado.</p>}
    <div className="space-y-1.5">{chats.map((chat) => {
      const agent = agentForChat(agents, chat)
      const selected = selectedKey === chat.key
      return <button key={chat.key} type="button" aria-pressed={selected} onClick={() => onSelect(chat)} title={chat.url}
        className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${selected ? 'border-whx-accent bg-whx-hover! shadow-[inset_2px_0_0_var(--theme-accent)]' : 'border-whx-border-soft bg-transparent! hover:border-whx-border-soft hover:bg-whx-muted!'}`}>
        <span className="flex items-center justify-between gap-2"><strong className="min-w-0 truncate text-whx-label font-semibold text-whx-text">{chat.title}</strong><span className="shrink-0 text-whx-caption uppercase tracking-wide text-whx-faint">{chat.kind === 'workspace' ? 'Chat' : chat.kind === 'planning' ? 'Plano' : 'Tarefa'}</span></span>
        <span className="mt-1 block truncate font-mono text-whx-caption text-whx-accent">{chat.url}</span>
        <span className="mt-1 block text-whx-caption text-whx-faint">{agent ? `${agent.label} · instância associada` : 'Visualização efêmera ao selecionar'}{chat.archived ? ' · arquivado' : ''}</span>
      </button>
    })}</div>
  </div>
}
