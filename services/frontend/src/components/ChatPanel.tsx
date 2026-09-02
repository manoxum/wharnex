import { FormEvent, useEffect, useRef, useState } from 'react'
import type { ChatItem, Session } from '../types'
import { Icon } from './Icon'
import { StatusPill } from './StatusPill'
import { stateLabel } from '../lib/risk'


export function ChatPanel({ session, items, busy, onSend }: { session: Session; items: ChatItem[]; busy: boolean; onSend: (message: string) => Promise<void> }) {
  const [message, setMessage] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [items, busy])
  async function submit(event: FormEvent) {
    event.preventDefault()
    const text = message.trim()
    if (!text || busy) return
    setMessage('')
    await onSend(text)
  }
  return (
    <section className="chat-panel">
      <header className="panel-header chat-header">
        <div><span className="panel-kicker">Harness chat</span><h2>{session.context.manifest.project_root.split('/').pop() || 'Projeto'}</h2></div>
        <StatusPill tone={session.state === 'failed' ? 'danger' : session.state === 'verified' || session.state === 'applied' ? 'success' : 'neutral'}>{stateLabel(session.state)}</StatusPill>
      </header>
      <div className="chat-stream">
        <div className="system-note"><Icon name="shield" size={17}/><div><strong>Contexto isolado</strong><span>{session.context.manifest.files.length.toLocaleString()} ficheiros · {session.context.manifest.sha256.slice(0, 12)}</span></div></div>
        {items.map((item) => <article key={item.id} className={`message message-${item.role}`}><div className="message-label">{item.role === 'user' ? 'Você' : 'Wharness'}</div><div className="message-body">{item.text}</div>{item.meta && <div className="message-meta">{item.meta}</div>}</article>)}
        {busy && <article className="message message-harness"><div className="message-label">Wharness</div><div className="thinking"><span/><span/><span/> A processar o plano</div></article>}
        <div ref={endRef} />
      </div>
      <form className="composer" onSubmit={submit}>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} placeholder="Descreva a alteração, correção ou verificação…" rows={3} />
        <div className="composer-footer"><span>Enter envia · Shift+Enter quebra linha</span><button disabled={busy || !message.trim()} aria-label="Enviar" className="send-button"><Icon name="send" /></button></div>
      </form>
    </section>
  )
}
