import type { AppConfig, ChatItem, Session, WorkspaceChat } from '../types'
import { Composer, type ComposerValue } from './Composer'

export function ChatPane({ chat, session, config, items, busy, onSend, onSave, onArchive, onSessionChange }: {
  chat: WorkspaceChat; session: Session; config?: AppConfig; items: ChatItem[]; busy: boolean
  onSend: (value: ComposerValue) => Promise<void>; onSave: () => void; onArchive: () => void; onSessionChange: (session: Session) => void
}) {
  return <section className="flex min-h-0 flex-1 flex-col bg-slate-900/45">
    <header className="flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/70 px-4 py-3">
      <div className="min-w-0"><h2 className="truncate text-sm font-semibold text-slate-100">{chat.title || 'Novo chat'}</h2><p className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500"><span className={`size-1.5 rounded-full ${['failed', 'blocked'].includes(session.state) ? 'bg-rose-400' : busy ? 'bg-amber-400' : 'bg-emerald-400'}`}/>{session.state} · Agent</p></div>
      <div className="flex gap-1.5"><button onClick={onSave} className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800">{chat.saved_at ? '★ Guardado' : '☆ Guardar'}</button><button onClick={onArchive} className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-400 hover:bg-slate-800">Arquivar</button></div>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8">
      <div className="mx-auto max-w-3xl space-y-4">
        {items.length === 0 && <div className="py-16 text-center"><div className="mx-auto grid size-12 place-items-center rounded-2xl bg-cyan-400/10 text-xl text-cyan-300">✦</div><h3 className="mt-4 font-semibold">Pronto para trabalhar neste projeto</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">O pedido será preparado pelo backend e executado pelo Supervisor/Workers do Desktop. O webapp acompanha a mesma sessão durável.</p></div>}
        {items.map((item) => <article key={item.id} className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 ${item.role === 'user' ? 'bg-cyan-400 text-slate-950' : 'border border-slate-800 bg-slate-950 text-slate-200'}`}><p className="whitespace-pre-wrap">{item.text}</p>{item.attachments?.length ? <p className={`mt-2 text-xs ${item.role === 'user' ? 'text-slate-800' : 'text-slate-500'}`}>{item.attachments.map((file) => file.name).join(' · ')}</p> : null}</div></article>)}
        {session.last_turn?.message && <article className="rounded-2xl border border-slate-800 bg-slate-950 p-4 text-sm leading-6 text-slate-300"><p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600">Último resultado Wharnex</p><p className="whitespace-pre-wrap">{session.last_turn.message}</p></article>}
        {busy && <div className="flex items-center gap-2 text-xs text-slate-500"><span className="size-2 animate-pulse rounded-full bg-cyan-400"/>A acompanhar a execução no Desktop…</div>}
      </div>
    </div>
    <Composer session={session} config={config} busy={busy} onSend={onSend} onSessionChange={onSessionChange}/>
  </section>
}
