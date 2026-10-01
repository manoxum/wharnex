import type { ChatItem, Session } from '../../../types'
import { activePendingRequestId } from '../../../lib/agent/runtime/pendingRequest'

export function chatItemSource(item: ChatItem) {
  return item.source || (item.role === 'user' ? 'user' : item.turnKind ? 'chatgpt' : 'wharness')
}
export function isWhxNotice(item: ChatItem) {
  return (item.presentation || 'message') === 'notice' && chatItemSource(item) === 'wharness'
}
export function indexWhxNoticeRuns(items: ChatItem[]) {
  const hiddenIds = new Set<string>()
  const previousByLatestId = new Map<string, ChatItem[]>()
  let run: ChatItem[] = []
  const flush = () => {
    if (run.length > 1) {
      const previous = run.slice(0, -1)
      previous.forEach((item) => hiddenIds.add(item.id))
      previousByLatestId.set(run[run.length - 1].id, previous)
    }
    run = []
  }
  for (const item of items) {
    if (isWhxNotice(item)) run.push(item)
    else { flush() }
  }
  flush()
  return { hiddenIds, previousByLatestId }
}

export function compactNoticeText(value: string) {
  const plain = value.replace(/```[\s\S]*?```/g, ' código ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_#>`~]/g, '').replace(/\s+/g, ' ').trim()
  if (!plain) return 'Atualização da execução.'
  return plain.length > 150 ? `${plain.slice(0, 147)}…` : plain
}

export function isFailureNotice(item: ChatItem) {
  return item.iteration?.phase === 'failed' || item.iteration?.artifacts.includes('error') || /falh|erro|bloquead/i.test(item.meta || '')
}
export function noticeIcon(item: ChatItem) { return item.turnKind === 'blocked' ? 'shield' : item.turnKind === 'workflow' ? 'terminal' : item.turnKind === 'change' ? 'apply' : item.iteration?.phase === 'failed' ? 'shield' : 'bridge' as const }
export function isPolicyBlockedNotice(item: ChatItem) { return item.meta?.includes('Policy bloqueada') || item.text.includes('bloqueado pela Policy') }
export function isTransportFailureNotice(item: ChatItem) { return item.meta?.includes('Falha de comunicação') || item.meta?.includes('Falha de protocolo') || item.meta?.includes('Pedido não concluído') }
export function canResendPreparedRequest(item: ChatItem) { return item.iteration?.phase === 'outbound' || item.iteration?.phase === 'prepared' || item.iteration?.phase === 'submitted' }
// A notice may reference a request that has since been superseded/cancelled.
// A present pending-request list is authoritative: once the backend removes a
// delivered request from it, last_request_id is historical provenance only.
// Legacy sessions without that field fall back to the states that can still
// own a live remote request.
export function isLivePendingRequest(session: Session, requestId: string) {
  return activePendingRequestId(session) === requestId
}

export function iterationPhaseLabel(value: NonNullable<ChatItem['iteration']>['phase']) {
  if (value === 'repair') return 'correção'
  if (value === 'workflow') return 'workflow'
  if (value === 'result') return 'resultado'
  if (value === 'failed') return 'falhou'
  if (value === 'prepared') return 'preparado'
  if (value === 'submitted') return 'enviado'
  return 'pedido'
}

export function formatMessageTime(value?: string) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}
