import { useEffect, useRef } from 'react'
import type { CodexThread } from '../../../lib/codex'
import { Icon } from '../../presentation/chrome/Icon'
import { desktopBridge } from '../../../lib/desktop/bridge/desktop'
import { CodexAskCard, CodexResumeControl } from '../interactions'
import { CodexMarkdown } from '../presentation'
import { CodexActivity } from './CodexActivity'
import { CodexThreadStatus } from './CodexThreadStatus'
import { CodexCancelControl } from './CodexCancelControl'

export function CodexConversation({ thread, accountLabel, connectionState = 'checking' }: {
  thread?: CodexThread; accountLabel?: string
  connectionState?: 'checking' | 'connected' | 'disconnected' | 'unavailable' | 'error'
}) {
  const end = useRef<HTMLDivElement>(null)
  const lastMessage = thread?.messages.at(-1)?.text
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'nearest' }) }, [lastMessage, thread?.status])
  if (!thread) {
    const emptyCopy = {
      checking: { title: 'A verificar a ligação', description: 'A confirmar o estado da conta Codex deste projeto.' },
      connected: { title: 'Codex pronto para a próxima conversa', description: 'Escolha Codex no compositor do Agent e envie o pedido. As perguntas, atividades e resultados serão acompanhados aqui.' },
      disconnected: { title: 'Ligue o Codex para começar', description: 'Associe uma conta no cabeçalho. Depois escolha Codex no compositor do Agent para iniciar uma conversa.' },
      unavailable: { title: 'Codex no Wharnex Desktop', description: 'A integração local fica disponível no Wharnex Desktop atualizado.' },
      error: { title: 'Não foi possível verificar a conta', description: 'Consulte o aviso acima e tente atualizar o estado do Codex.' },
    }[connectionState]
    return <div aria-live={connectionState === 'checking' ? 'polite' : undefined} className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-8 text-center">
      <span className="mb-5 grid size-14 shrink-0 place-items-center rounded-2xl border border-whx-accent/20 bg-whx-accent-soft text-whx-accent"><Icon name="code" size={28}/></span>
      <h3 className="m-0 text-xl font-semibold tracking-tight">{emptyCopy.title}</h3>
      <p className="mb-0 mt-3 max-w-80 text-[calc(12px*var(--ui-font-scale))] leading-6 text-whx-soft">{emptyCopy.description}</p>
      {connectionState === 'disconnected' && <p className="mb-0 mt-4 max-w-80 text-[calc(11px*var(--ui-font-scale))] leading-5 text-whx-faint">O acesso direto ao computador continua sujeito ao nível de permissão escolhido no compositor.</p>}
    </div>
  }
  return <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Conversa Codex">
    <div className="flex shrink-0 flex-col gap-2 border-b border-whx-border-soft px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[calc(9px*var(--ui-font-scale))] font-medium uppercase tracking-widest text-whx-faint">Conversa atual</span><CodexThreadStatus status={thread.status}/></div>
      <h3 className="m-0 break-words text-[calc(12px*var(--ui-font-scale))] font-semibold leading-6" title={thread.title}>{thread.title}</h3>
      {thread.selfEvolution && <span className="text-[calc(10px*var(--ui-font-scale))] text-whx-accent">Auto Evolution</span>}
    </div>
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5">
      <div className="mx-auto max-w-3xl">
        {thread.messages.map((message) => <article key={message.id} aria-label={message.role === 'user' ? 'Mensagem sua' : 'Mensagem do Codex'} className={`mb-6 min-w-0 ${message.role === 'user' ? 'rounded-xl border border-whx-border-soft bg-whx-muted p-3' : ''}`}>
          <div className="mb-2 flex items-center gap-2 text-[calc(10px*var(--ui-font-scale))] font-semibold text-whx-faint"><Icon name={message.role === 'user' ? 'chatgpt' : 'code'} size={14}/>{message.role === 'user' ? 'Você' : 'Codex'}</div>
          <CodexMarkdown text={message.text}/>
        </article>)}
        <CodexActivity items={thread.activities || []}/>
        {thread.pendingAsks?.map((ask) => <CodexAskCard key={ask.id} ask={ask} onAnswer={async (response) => {
          const codex = desktopBridge()?.codex
          if (!codex?.answer) throw new Error('Atualize o Desktop para responder ao Codex.')
          return codex.answer(thread.projectPath, thread.chatId, thread.requestId, ask.id, response)
        }}/>)}
        {thread.status === 'running' && <p className="my-4 flex items-center gap-2 text-[calc(10px*var(--ui-font-scale))] text-whx-faint"><span className="size-1.5 rounded-full bg-whx-accent motion-safe:animate-pulse"/> Codex está a processar o pedido…</p>}
        {thread.error && <p role="alert" className="rounded-lg border border-whx-warning/30 bg-whx-warning/5 p-3 text-[calc(11px*var(--ui-font-scale))] leading-6 text-whx-warning">{thread.error}</p>}
        {thread.archiveError && <p role="alert" className="text-[calc(11px*var(--ui-font-scale))] leading-6 text-whx-warning">{thread.archiveError}</p>}
        <CodexCancelControl key={thread.requestId} thread={thread}/>
        {thread.status === 'ready' && <div className="flex items-start gap-2 rounded-xl border border-whx-border-soft bg-whx-elevated p-3 text-[calc(11px*var(--ui-font-scale))] leading-6 text-whx-soft"><span className="mt-1 shrink-0"><Icon name="package" size={16}/></span><span>Bundle entregue ao Wharnex. A validação, o plano e as alterações aparecem no chat, Plano e Execução.</span></div>}
        <div ref={end}/>
      </div>
    </div>
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-whx-border-soft bg-whx-muted/40 px-4 py-2.5 text-[calc(9px*var(--ui-font-scale))] text-whx-faint"><CodexResumeControl key={`resume-${thread.requestId}`} thread={thread} accountLabel={accountLabel}/><span className="min-w-0 break-all font-mono">{thread.model || 'Modelo padrão'}{thread.native ? ` · ${{ ask: 'Pedir aprovação', auto: 'Aprovar por mim', full: 'Acesso total' }[thread.permissionLevel || 'full']}` : ''}</span><span className="font-mono tabular-nums">{thread.tokenUsage ? `${thread.tokenUsage.total.totalTokens.toLocaleString()} tokens` : 'Consumo pendente'}</span></footer>
  </section>
}
