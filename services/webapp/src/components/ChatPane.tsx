import type { AppConfig, ChatItem, Session, WorkspaceChat } from '../types'
import { Composer, type ComposerValue } from './Composer'

export function ChatPane({ chat, session, config, items, busy, onSend, onSave, onArchive, onSessionChange }: {
  chat: WorkspaceChat; session: Session; config?: AppConfig; items: ChatItem[]; busy: boolean
  onSend: (value: ComposerValue) => Promise<void>; onSave: () => void; onArchive: () => void; onSessionChange: (session: Session) => void
}) {
  return <section className="flex min-h-0 flex-1 flex-col bg-canvas">
    <header className="flex min-h-16 items-center justify-between gap-3 border-b border-line bg-surface/90 px-4 py-3 backdrop-blur-xl sm:px-6">
      <div className="min-w-0"><h2 className="truncate text-sm font-semibold text-ink">{chat.title || 'Novo chat'}</h2><p className="mt-1 flex items-center gap-2 text-[11px] text-faint"><span className={`size-1.5 rounded-full ${['failed', 'blocked'].includes(session.state) ? 'bg-danger' : busy ? 'bg-warning' : 'bg-success'}`}/><span>{session.state}</span><span className="text-line">•</span><span>Agent</span></p></div>
      <div className="flex shrink-0 gap-1.5"><button onClick={onSave} className="rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs font-medium text-soft transition hover:bg-hover hover:text-ink">{chat.saved_at ? '★ Guardado' : '☆ Guardar'}</button><button onClick={onArchive} className="rounded-lg px-2.5 py-1.5 text-xs text-faint transition hover:bg-hover hover:text-soft">Arquivar</button></div>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-6 sm:px-8">
      <div className="mx-auto max-w-3xl space-y-5">
        {items.length === 0 && <div className="mx-auto max-w-lg py-20 text-center"><div className="mx-auto grid size-12 place-items-center rounded-2xl border border-line-soft bg-accent-soft text-xl text-accent shadow-[0_12px_40px_var(--theme-shadow)]">✦</div><h3 className="mt-5 text-base font-semibold text-ink">Um espaço limpo para o próximo pedido</h3><p className="mt-2 text-sm leading-6 text-faint">Escreva como faria no Desktop. O pedido, contexto e execução continuam ligados à mesma sessão Wharnex.</p></div>}
        {items.map((item) => <Message key={item.id} item={item}/>)}
        {busy && <div className="flex items-center gap-2 rounded-xl border border-line-soft bg-surface px-3 py-2 text-xs text-faint"><span className="size-2 animate-pulse rounded-full bg-accent"/><span>A acompanhar a execução no Desktop…</span></div>}
      </div>
    </div>
    <Composer session={session} config={config} busy={busy} onSend={onSend} onSessionChange={onSessionChange}/>
  </section>
}

function Message({ item }: { item: ChatItem }) {
  const user = item.role === 'user'
  const notice = item.presentation === 'notice'
  return <article className={`flex gap-3 ${user ? 'justify-end' : 'justify-start'}`}>
    {!user && <div className="mt-1 grid size-7 shrink-0 place-items-center rounded-lg border border-line bg-elevated text-[10px] font-black text-accent">W</div>}
    <div className={`min-w-0 max-w-[88%] sm:max-w-[82%] ${user ? 'rounded-2xl rounded-br-md bg-accent px-4 py-3 text-accent-ink shadow-sm' : `rounded-2xl rounded-bl-md border px-4 py-3 ${notice ? 'border-accent/30 bg-accent-soft' : 'border-line bg-surface'}`}`}>
      {!user && <p className="mb-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-faint">Wharnex</p>}
      <p className={`whitespace-pre-wrap text-sm leading-6 ${user ? '' : 'text-soft'}`}>{item.text}</p>
      {item.attachments?.length ? <div className="mt-3 flex flex-wrap gap-1.5">{item.attachments.map((file) => <span key={`${file.name}-${file.size}`} className={`rounded-md px-2 py-1 text-[10px] ${user ? 'bg-black/10' : 'bg-muted text-faint'}`}>📎 {file.name}</span>)}</div> : null}
    </div>
  </article>
}
