import type { ProjectStorage, WorkspaceChat } from '../types'

const nameOf = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) || path

export function ProjectSidebar({ projects, project, chats, activeChatID, onProject, onChat, onNewChat }: {
  projects: ProjectStorage[]; project: string; chats: WorkspaceChat[]; activeChatID: string
  onProject: (path: string) => void; onChat: (chat: WorkspaceChat) => void; onNewChat: () => void
}) {
  return <aside className="flex min-h-0 flex-col border-r border-slate-800 bg-slate-950/80">
    <div className="border-b border-slate-800 p-3">
      <label className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Projeto</label>
      <select value={project} onChange={(event) => onProject(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm font-semibold outline-none focus:border-cyan-400">
        {projects.map((item) => <option key={item.project_path} value={item.project_path}>{nameOf(item.project_path)}</option>)}
      </select>
    </div>
    <div className="flex items-center justify-between px-3 pb-2 pt-4"><span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Chats</span><button onClick={onNewChat} className="rounded-lg bg-cyan-400/10 px-2.5 py-1.5 text-xs font-bold text-cyan-300 hover:bg-cyan-400/20">+ Novo</button></div>
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      {chats.filter((chat) => !chat.archived_at).map((chat) => <button key={chat.id} onClick={() => onChat(chat)} className={`mb-1 w-full rounded-xl px-3 py-2.5 text-left transition ${activeChatID === chat.id ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'}`}>
        <span className="block truncate text-sm font-medium">{chat.title || 'Novo chat'}</span>
        <span className="mt-1 flex items-center gap-2 text-[11px] text-slate-600">{chat.saved_at ? '★ Guardado' : 'Chat'} · {new Date(chat.updated_at).toLocaleDateString()}</span>
      </button>)}
      {!chats.some((chat) => !chat.archived_at) && <p className="px-3 py-6 text-center text-xs leading-5 text-slate-600">Sem chats ativos neste projeto.</p>}
      {chats.some((chat) => chat.archived_at) && <><p className="px-3 pb-2 pt-4 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-700">Arquivados</p>{chats.filter((chat) => chat.archived_at).map((chat) => <button key={chat.id} onClick={() => onChat(chat)} className="mb-1 w-full rounded-xl px-3 py-2 text-left text-slate-600 hover:bg-slate-900 hover:text-slate-300"><span className="block truncate text-xs font-medium">{chat.title || 'Chat arquivado'}</span></button>)}</>}
    </div>
  </aside>
}
