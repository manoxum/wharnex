import { useState } from 'react'
import type { Session } from '../types'
import type { WorkspaceChat } from '../lib/workspaceMemory'
import type { ExecutionFIFOItem } from '../lib/executionQueueView'
import { Icon } from './Icon'

export type InterruptedExecutionTarget = {
  chat: WorkspaceChat
  session: Session
  queue?: ExecutionFIFOItem
  humanAction?: DesktopChatGPTHumanAction
}

type RecoveryDecision = 'continue' | 'discard'

type Props = {
  items: InterruptedExecutionTarget[]
  busyChats: Record<string, boolean>
  onDecision: (target: InterruptedExecutionTarget, decision: RecoveryDecision) => void
  onOpenChat: (target: InterruptedExecutionTarget) => void
  onOpenLogs: (target: InterruptedExecutionTarget) => void
  onOpenChatGPT: (target: InterruptedExecutionTarget) => void
}

export function InterruptedExecutionRecovery({ items, busyChats, onDecision, onOpenChat, onOpenLogs, onOpenChatGPT }: Props) {
  const [open, setOpen] = useState(true)
  return <aside className={`execution-recovery-center ${open ? 'open' : ''}`} aria-label="Centro de recuperação de execuções">
    <button type="button" className="execution-recovery-trigger" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <Icon name="shield" size={14}/><strong>{items.length}</strong><span>{items.length === 1 ? 'execução precisa de atenção' : 'execuções precisam de atenção'}</span><Icon name="chevron" size={12}/>
    </button>
    {open && <section className="execution-recovery-panel" aria-label="Execuções interrompidas">
      <header><div><span className="panel-kicker">Recuperação segura</span><h2>Execuções interrompidas</h2></div><button type="button" className="icon-button" aria-label="Recolher centro de recuperação" onClick={() => setOpen(false)}><Icon name="close" size={13}/></button></header>
      <p>Nenhuma execução é retomada sem a sua decisão. Pode continuar a usar chats, Editor, logs e ChatGPT enquanto resolve cada item.</p>
      <div className="execution-recovery-list">{items.map((target) => <RecoveryCard key={`${target.session.id}:${target.session.interrupted_execution?.plan_id || ''}`} target={target} pending={Boolean(busyChats[target.chat.id])} onDecision={onDecision} onOpenChat={onOpenChat} onOpenLogs={onOpenLogs} onOpenChatGPT={onOpenChatGPT}/>)}</div>
    </section>}
  </aside>
}

function RecoveryCard({ target, pending, onDecision, onOpenChat, onOpenLogs, onOpenChatGPT }: {
  target: InterruptedExecutionTarget
  pending: boolean
  onDecision: Props['onDecision']
  onOpenChat: Props['onOpenChat']
  onOpenLogs: Props['onOpenLogs']
  onOpenChatGPT: Props['onOpenChatGPT']
}) {
  const intent = target.session.interrupted_execution!
  const state = recoveryState(target, pending)
  const active = pending || intent.status === 'resuming' || intent.status === 'running'
  const retry = intent.status === 'failed_retryable'
  return <article className="execution-recovery-item">
    <div className="execution-recovery-copy">
      <div className="execution-recovery-title"><strong>{target.chat.title}</strong><span className={`execution-recovery-status ${state.tone}`}>{state.label}</span></div>
      <span>{target.session.plan?.summary || intent.plan_id}</span>
      <small>{intent.plan_id} · {new Date(intent.requested_at).toLocaleString()} · {target.session.execution_mode === 'unprotected' ? 'Host direto' : 'Sandbox protegida'}</small>
      {intent.last_error && <small className="execution-recovery-error">{intent.last_error}</small>}
    </div>
    <div className="execution-recovery-actions">
      <button type="button" className="text-button" onClick={() => onOpenChat(target)}>Abrir chat</button>
      <button type="button" className="text-button" onClick={() => onOpenLogs(target)}><Icon name="terminal" size={12}/> Ver logs</button>
      {target.humanAction?.active && <button type="button" className="text-button recovery-human-action" onClick={() => onOpenChatGPT(target)}><Icon name="shield" size={12}/> Abrir ChatGPT</button>}
      <button type="button" className="secondary-button" disabled={active} onClick={() => onDecision(target, 'discard')}>Descartar</button>
      <button type="button" className="apply-button" disabled={active} onClick={() => onDecision(target, 'continue')}><Icon name={active ? 'refresh' : 'play'} size={13}/>{active ? 'A acompanhar' : retry ? 'Repetir' : 'Continuar'}</button>
    </div>
  </article>
}

function recoveryState(target: InterruptedExecutionTarget, pending: boolean) {
  const intent = target.session.interrupted_execution!
  if (target.humanAction?.active) return { label: 'Ação humana necessária', tone: 'warning' }
  if (target.queue?.status === 'queued') return { label: target.queue.position ? `Na fila · ${target.queue.position}` : 'Na fila', tone: 'neutral' }
  if (target.queue?.status === 'running' || target.queue?.status === 'submitting') return { label: 'Em execução', tone: 'active' }
  if (pending || intent.status === 'resuming' || intent.status === 'running') return { label: 'Retomando', tone: 'active' }
  if (intent.status === 'failed_retryable') return { label: 'Falhou · pode repetir', tone: 'danger' }
  return { label: 'Aguardando decisão', tone: 'warning' }
}
