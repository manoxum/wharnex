import { translate as uiText } from '../../../lib/workspace/localization'
import { ATTENTION_ACTION_LABEL, attentionResolutionLabel, type AttentionAction, type AttentionItem } from '../../../lib/attention/center/attentionCenter'
import { Icon } from '../../presentation/chrome/Icon'

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
  return <div className={`attention-list text-whx-body ${density}`} role="list" aria-label={uiText("Alertas")}>
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
  const resolution = uiText(attentionResolutionLabel(item))
  const actionLabel = item.action ? uiText(ATTENTION_ACTION_LABEL[item.action]) : ''
  const actionDisabled = current && busy

  return <article className={`attention-card ${item.tone}`} role="listitem">
    <button
      type="button"
      className="attention-card-main text-whx-body leading-normal"
      onClick={() => void onOpen(item)}
      aria-label={`${item.chatTitle} · ${item.title} · ${resolution}`}
    >
      <span className="attention-card-marker"><Icon name={item.tone === 'danger' ? 'shield' : item.tone === 'success' ? 'apply' : 'bell'} size={density === 'compact' ? 13 : 15}/></span>
      <span className="attention-card-copy">
        <span className="attention-card-meta">
          <small className={`attention-card-severity text-whx-caption font-medium leading-tight ${item.tone}`}>{uiText(TONE_LABEL[item.tone])}</small>
          {density === 'full' || !current ? <small className="attention-card-chat text-whx-caption leading-normal" title={item.chatTitle}>{item.chatTitle}</small> : null}
          {current && density === 'full' ? <small className="attention-card-current text-whx-caption leading-normal">{uiText("Chat Atual")}</small> : null}
        </span>
        <strong className="text-whx-label font-semibold leading-snug">{item.title}</strong>
        <span className="attention-card-detail text-whx-body leading-relaxed" title={item.detail}>{item.detail}</span>
      </span>
      <Icon name="arrow-right" size={13}/>
    </button>
    <footer className="attention-card-footer">
      {!item.action && <span className="attention-card-next text-whx-caption leading-normal">{resolution}</span>}
      {item.action ? <button
        type="button"
        className="attention-card-action text-whx-label font-medium leading-tight"
        disabled={actionDisabled}
        onClick={() => void onAction(item)}
        aria-label={current ? actionLabel : `Abrir ${item.chatTitle} para ${actionLabel}`}
      >
        <Icon name={current ? ACTION_ICON[item.action] : 'arrow-right'} size={13}/>
        {actionDisabled ? uiText("A processar…") : current ? actionLabel : uiText("Abrir para resolver")}
      </button> : null}
    </footer>
  </article>
}
