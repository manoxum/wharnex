import { ChatSurfaceTabs } from './navigation'
import { useState } from 'react'
import type { AppConfig, ChatItem, PanelName, Session, WorkspaceChat } from '../transport/contracts'
import { Composer, type ComposerValue } from './composer/Composer'
import { RichMessage } from './RichMessage'

export function ChatPane({ chat, session, config, items, busy, onSend, onSave, onArchive, onSessionChange, onNavigate, onOpenPanel }: {
  chat: WorkspaceChat; session: Session; config?: AppConfig; items: ChatItem[]; busy: boolean
  onSend: (value: ComposerValue) => Promise<void>; onSave: () => void; onArchive: () => void; onSessionChange: (session: Session) => void
  onNavigate: (surface: 'plan' | 'files' | 'execution') => void; onOpenPanel: (panel: PanelName) => void
}) {
  const [composerVisible, setComposerVisible] = useState(true); const [menuOpen, setMenuOpen] = useState(false)
  async function send(value: ComposerValue) { await onSend(value); setComposerVisible(false) }
  return <section className="relative flex min-h-0 flex-1 flex-col bg-canvas">
    <header className="border-b border-line bg-surface/90 px-3 py-2.5 backdrop-blur-xl sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0"><h2 className="truncate text-sm font-semibold text-ink">{chat.title || 'Novo chat'}</h2><p className="mt-1 flex items-center gap-2 text-[11px] text-faint"><span className={`size-1.5 rounded-full ${['failed', 'blocked'].includes(session.state) ? 'bg-danger' : busy ? 'bg-warning' : 'bg-success'}`}/><span>{session.state}</span><span className="text-line">•</span><span>Agent</span>{chat.saved_at && <><span className="text-line">•</span><span>★</span></>}</p></div>
        <div className="relative"><button onClick={() => setMenuOpen((value) => !value)} className="grid size-9 place-items-center rounded-xl border border-line bg-elevated text-lg text-soft hover:bg-hover" aria-label="Ações do chat" aria-expanded={menuOpen}>•••</button>{menuOpen && <div className="absolute right-0 top-11 z-20 w-44 rounded-xl border border-line bg-elevated p-1.5 shadow-[0_18px_50px_var(--theme-shadow)]"><Action onClick={() => { onSave(); setMenuOpen(false) }}>{chat.saved_at ? '☆ Remover guardado' : '★ Guardar chat'}</Action><Action onClick={() => { onArchive(); setMenuOpen(false) }}>↘ Arquivar chat</Action></div>}</div>
      </div>
      <ChatSurfaceTabs onNavigate={onNavigate}/>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-8">
      <div className="mx-auto max-w-3xl space-y-5">
        {items.length === 0 && <div className="mx-auto max-w-lg py-16 text-center"><div className="mx-auto grid size-12 place-items-center rounded-2xl border border-line-soft bg-accent-soft text-xl text-accent shadow-[0_12px_40px_var(--theme-shadow)]">✦</div><h3 className="mt-5 text-base font-semibold text-ink">Um espaço limpo para o próximo pedido</h3><p className="mt-2 text-sm leading-6 text-faint">Use as mesmas directivas e controlos do Desktop a partir da bandeja compacta do composer.</p></div>}
        {items.map((item) => <Message key={item.id} item={item}/>)}
        {busy && <div className="flex items-center gap-2 rounded-xl border border-line-soft bg-surface px-3 py-2 text-xs text-faint"><span className="size-2 animate-pulse rounded-full bg-accent"/><span>A acompanhar a execução no Desktop…</span></div>}
      </div>
    </div>
    {composerVisible ? <Composer session={session} config={config} busy={busy} onSend={send} onSessionChange={onSessionChange} onOpenPanel={onOpenPanel}/> : <button onClick={() => setComposerVisible(true)} className="absolute bottom-4 right-4 z-10 flex items-center gap-2 rounded-2xl border border-accent/30 bg-accent px-4 py-3 text-xs font-bold text-accent-ink shadow-[0_16px_45px_var(--theme-shadow)] hover:brightness-105" aria-label="Reabrir composer"><span className="text-base">✎</span> Escrever</button>}
  </section>
}

function Message({ item }: { item: ChatItem }) {
  const user = item.role === 'user'; const notice = item.presentation === 'notice'
  return <article className={`flex gap-3 ${user ? 'justify-end' : 'justify-start'}`}>
    {!user && <div className="mt-1 grid size-7 shrink-0 place-items-center rounded-lg border border-line bg-elevated text-[10px] font-black text-accent">W</div>}
    <div className={`min-w-0 max-w-[94%] sm:max-w-[84%] ${user ? 'rounded-2xl rounded-br-md bg-accent px-4 py-3 text-accent-ink shadow-sm' : `rounded-2xl rounded-bl-md border px-4 py-3 ${notice ? 'border-accent/30 bg-accent-soft' : 'border-line bg-surface'}`}`}>
      {!user && <p className="mb-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-faint">Wharnex</p>}
      <RichMessage item={item} user={user}/>
    </div>
  </article>
}

function Action({ children, onClick }: { children: string; onClick: () => void }) { return <button onClick={onClick} className="block w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-soft hover:bg-hover hover:text-ink">{children}</button> }
