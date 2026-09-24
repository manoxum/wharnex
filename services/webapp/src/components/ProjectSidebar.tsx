import type { ProjectHistoryEntry, WorkspaceChat } from '../types'

const nameOf = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) || path

export function ProjectSidebar({ projects, project, chats, activeChatID, onProject, onChat, onNewChat, onHome }: {
  projects: ProjectHistoryEntry[]; project: string; chats: WorkspaceChat[]; activeChatID: string
  onProject: (path: string) => void; onChat: (chat: WorkspaceChat) => void; onNewChat: () => void; onHome: () => void
}) {
  const active = chats.filter((chat) => !chat.archived_at)
  const archived = chats.filter((chat) => chat.archived_at)
  return <aside className="flex min-h-0 flex-col border-r border-line bg-surface">
    <div className="border-b border-line p-3"><button onClick={onHome} className="mb-3 flex w-full items-center gap-2 rounded-xl bg-muted px-3 py-2 text-left text-xs font-semibold text-soft hover:bg-hover hover:text-ink">⌂ <span>Todos os projetos</span></button><label className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-faint">Projeto</label><select value={project} onChange={(event) => onProject(event.target.value)} className="mt-2 w-full rounded-xl border border-line bg-elevated px-3 py-2.5 text-sm font-semibold text-ink outline-none transition focus:border-accent"><option value="" disabled>Selecione um projeto</option>{projects.map((item) => <option key={item.project_path} value={item.project_path}>{item.name || nameOf(item.project_path)}</option>)}</select></div>
    <div className="flex items-center justify-between px-3 pb-2 pt-4"><span className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-faint">Conversas</span><button onClick={onNewChat} className="rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs font-bold text-accent transition hover:brightness-105">＋ Novo</button></div>
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      {active.map((chat) => <button key={chat.id} onClick={() => onChat(chat)} className={`group relative mb-1 w-full rounded-xl px-3 py-2.5 text-left transition ${activeChatID === chat.id ? 'bg-accent-soft text-ink' : 'text-soft hover:bg-hover hover:text-ink'}`}>{activeChatID === chat.id && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent"/>}<span className="block truncate text-sm font-medium">{chat.title || 'Novo chat'}</span><span className="mt-1 flex items-center gap-1.5 text-[10px] text-faint">{chat.saved_at ? '★ Guardado' : 'Chat'} <span>·</span> {new Date(chat.updated_at).toLocaleDateString()}</span></button>)}
      {!active.length && <p className="px-3 py-8 text-center text-xs leading-5 text-faint">Sem chats ativos neste projeto.</p>}
      {archived.length > 0 && <><p className="px-3 pb-2 pt-4 text-[10px] font-extrabold uppercase tracking-[0.16em] text-faint">Arquivados</p>{archived.map((chat) => <button key={chat.id} onClick={() => onChat(chat)} className="mb-1 w-full rounded-xl px-3 py-2 text-left text-faint transition hover:bg-hover hover:text-soft"><span className="block truncate text-xs font-medium">{chat.title || 'Chat arquivado'}</span></button>)}</>}
    </div>
  </aside>
}
