import { ATTENTION_ACTION_LABEL, type AttentionAction, type AttentionItem } from '../lib/attentionCenter'
import { Icon } from './Icon'

const ACTION_ICON: Record<AttentionAction, 'play' | 'network' | 'apply'> = {
  'approve-execution': 'play',
  'retry-dependency-network': 'network',
  'repair-host-dependency': 'network',
  'repair-with-gpt': 'play',
  'retry-transport': 'network',
  'retry-host-apply': 'apply',
  'apply-host': 'apply',
}

export function AttentionPopover({ items, activeChatId, busy, onOpen, onAction, onOpenAll }: {
  items: AttentionItem[]
  activeChatId: string
  busy: boolean
  onOpen: (item: AttentionItem) => Promise<void>
  onAction: (item: AttentionItem) => Promise<void>
  onOpenAll: () => void
}) {
  const urgentCount = items.filter((item) => item.tone === 'danger').length
  return <section className="agent-attention-popover" role="dialog" aria-label="Alertas ativos" data-chatgpt-overlay-blocker="true">
    <header>
      <div><span>Centro de alertas</span><strong>{items.length} {items.length === 1 ? 'alerta' : 'alertas'}</strong></div>
      <small>{urgentCount} {urgentCount === 1 ? 'urgente' : 'urgentes'}</small>
    </header>
    <div className="agent-attention-popover-list">
      {items.map((item) => <article className={`agent-attention-popover-item ${item.tone}`} key={item.id}>
        <button type="button" className="agent-attention-popover-link" disabled={busy && item.chatId !== activeChatId} onClick={() => void onOpen(item)} aria-label={`${item.chatTitle} · ${item.title}`}>
          <span className="agent-attention-popover-marker"><Icon name={item.tone === 'danger' ? 'shield' : item.tone === 'success' ? 'apply' : 'bell'} size={14}/></span>
          <span className="agent-attention-popover-copy"><small>{item.chatTitle}{item.chatId === activeChatId ? ' · chat atual' : ''}</small><strong>{item.title}</strong><span>{item.detail}</span></span>
          <Icon name="arrow-right" size={13}/>
        </button>
        {item.action && <button type="button" className="agent-attention-popover-action" disabled={busy} onClick={() => void onAction(item)} aria-label={item.chatId === activeChatId ? ATTENTION_ACTION_LABEL[item.action] : `Abrir ${item.chatTitle} para ${ATTENTION_ACTION_LABEL[item.action]}`}><Icon name={ACTION_ICON[item.action]} size={13}/>{item.chatId === activeChatId ? ATTENTION_ACTION_LABEL[item.action] : `Abrir · ${ATTENTION_ACTION_LABEL[item.action]}`}</button>}
      </article>)}
    </div>
    <footer><button type="button" onClick={onOpenAll}><Icon name="bell" size={13}/> Ver todos os alertas <Icon name="arrow-right" size={12}/></button></footer>
  </section>
}
