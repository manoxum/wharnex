import { ATTENTION_ACTION_LABEL, attentionResolutionLabel, type AttentionAction, type AttentionItem } from '../lib/attentionCenter'
import { Icon } from './Icon'

const ACTION_ICON: Record<AttentionAction, 'play' | 'network' | 'apply'> = {
  'approve-execution': 'play',
  'approve-debug': 'play',
  'retry-dependency-network': 'network',
  'repair-host-dependency': 'network',
  'repair-with-gpt': 'play',
  'retry-transport': 'network',
  'retry-host-apply': 'apply',
}

const TONE_LABEL = {
  danger: 'Urgente',
  warning: 'Atenção',
  success: 'Pronto',
} as const

export function AttentionList({ items, activeChatId, busy, density, onOpen, onAction }: {
  items: AttentionItem[]
  activeChatId: string
  busy: boolean
  density: 'compact' | 'full'
  onOpen: (item: AttentionItem) => Promise<void>
  onAction: (item: AttentionItem) => Promise<void>
}) {
  return <div className={`attention-list ${density}`} role="list" aria-label="Alertas">
    {items.map((item) => <AttentionCard
      key={item.id}
      item={item}
      current={item.chatId === activeChatId}
      busy={busy}
      density={density}
      onOpen={onOpen}
      onAction={onAction}
    />)}
  </div>
}

function AttentionCard({ item, current, busy, density, onOpen, onAction }: {
  item: AttentionItem
  current: boolean
  busy: boolean
  density: 'compact' | 'full'
  onOpen: (item: AttentionItem) => Promise<void>
  onAction: (item: AttentionItem) => Promise<void>
}) {
  const resolution = attentionResolutionLabel(item)
  const actionLabel = item.action ? ATTENTION_ACTION_LABEL[item.action] : ''
  const actionDisabled = current && busy

  return <article className={`attention-card ${item.tone}`} role="listitem">
    <button
      type="button"
      className="attention-card-main"
      onClick={() => void onOpen(item)}
      aria-label={`${item.chatTitle} · ${item.title} · ${resolution}`}
    >
      <span className="attention-card-marker"><Icon name={item.tone === 'danger' ? 'shield' : item.tone === 'success' ? 'apply' : 'bell'} size={density === 'compact' ? 13 : 15}/></span>
      <span className="attention-card-copy">
        <span className="attention-card-meta">
          <small className={`attention-card-severity ${item.tone}`}>{TONE_LABEL[item.tone]}</small>
          {density === 'full' || !current ? <small className="attention-card-chat" title={item.chatTitle}>{item.chatTitle}</small> : null}
          {current ? <small className="attention-card-current">Chat Atual</small> : null}
        </span>
        <strong>{item.title}</strong>
        <span className="attention-card-detail" title={item.detail}>{item.detail}</span>
      </span>
      <Icon name="arrow-right" size={13}/>
    </button>
    <footer className="attention-card-footer">
      <span className="attention-card-next">
        {item.action ? (current ? 'Ação disponível' : `Depois de abrir · ${actionLabel}`) : `Próximo passo · ${resolution}`}
      </span>
      {item.action ? <button
        type="button"
        className="attention-card-action"
        disabled={actionDisabled}
        onClick={() => void onAction(item)}
        aria-label={current ? actionLabel : `Abrir ${item.chatTitle} para ${actionLabel}`}
      >
        <Icon name={current ? ACTION_ICON[item.action] : 'arrow-right'} size={13}/>
        {actionDisabled ? 'A processar…' : current ? actionLabel : 'Abrir para resolver'}
      </button> : null}
    </footer>
  </article>
}
