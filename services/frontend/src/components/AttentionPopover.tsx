import { useEffect, useRef, type CSSProperties } from 'react'
import { attentionPreviewItems, summarizeAttention, type AttentionItem } from '../lib/attentionCenter'
import { AttentionList } from './AttentionList'
import { Icon } from './Icon'

const countFormat = new Intl.NumberFormat('pt-PT')

export function AttentionPopover({ items, activeChatId, busy, position, onOpen, onAction, onOpenAll, onClose }: {
  items: AttentionItem[]
  activeChatId: string
  busy: boolean
  position?: CSSProperties
  onOpen: (item: AttentionItem) => Promise<void>
  onAction: (item: AttentionItem) => Promise<void>
  onOpenAll: () => void
  onClose: () => void
}) {
  const rootRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const summary = summarizeAttention(items)
  const preview = attentionPreviewItems(items)
  const hiddenCount = summary.total - preview.length

  // Opening the preview is an explicit user action. Keep it transient like the
  // other header popovers: Escape and outside pointer presses dismiss it, while
  // the bell trigger is exempt so its own click can deterministically toggle it.
  useEffect(() => {
    closeRef.current?.focus()
    const insideAttention = (target: EventTarget | null) => target instanceof Element && (
      Boolean(rootRef.current?.contains(target)) || Boolean(target.closest('[data-attention-trigger="true"]'))
    )
    const outside = (event: PointerEvent | FocusEvent) => { if (!insideAttention(event.target)) onClose() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', outside, true)
    document.addEventListener('keydown', escape, true)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('focusin', outside, true)
      document.removeEventListener('keydown', escape, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return <section ref={rootRef} id="agent-attention-popover" className="agent-attention-popover" style={position} role="dialog" aria-modal="false" aria-label="Alertas ativos" aria-describedby="agent-attention-popover-description" data-chatgpt-overlay-blocker="true">
    <header>
      <div className="agent-attention-popover-heading">
        <span className="agent-attention-popover-symbol" aria-hidden="true"><Icon name={summary.urgent ? 'shield' : 'bell'} size={16}/></span>
        <div className="agent-attention-popover-heading-copy">
          <span>Atenção do projeto</span>
          <h2 id="agent-attention-popover-title">Centro de Alertas</h2>
          <p id="agent-attention-popover-description">O que precisa de atenção agora, sem ruído.</p>
        </div>
      </div>
      <button ref={closeRef} type="button" className="agent-attention-popover-close" onClick={onClose} aria-label="Fechar Centro de Alertas" title="Fechar"><Icon name="close" size={13}/></button>
    </header>
    <div className="agent-attention-popover-metrics" aria-label="Resumo dos alertas">
      <span><b>{countFormat.format(summary.total)}</b><small>{summary.total === 1 ? 'Ativo' : 'Ativos'}</small></span>
      <span className={summary.urgent ? 'danger' : ''}><b>{countFormat.format(summary.urgent)}</b><small>{summary.urgent === 1 ? 'Urgente' : 'Urgentes'}</small></span>
      <span><b>{countFormat.format(summary.actionable)}</b><small>Com ação</small></span>
    </div>
    <div className="agent-attention-popover-list">
      {preview.length
        ? <AttentionList items={preview} activeChatId={activeChatId} busy={busy} density="compact" onOpen={onOpen} onAction={onAction}/>
        : <div className="agent-drawer-empty attention-empty"><Icon name="check" size={18}/><strong>Nada requer atenção</strong><span>Novas notificações deste projeto aparecerão aqui.</span></div>}
      {hiddenCount > 0 ? <p className="agent-attention-popover-overflow">Mais {countFormat.format(hiddenCount)} {hiddenCount === 1 ? 'alerta está disponível' : 'alertas estão disponíveis'} no painel completo.</p> : null}
    </div>
    <footer><button type="button" onClick={onOpenAll} aria-label="Ver todos os alertas"><span>Abrir centro de alertas</span><span className="agent-attention-popover-footer-count">{countFormat.format(summary.total)}</span><Icon name="arrow-right" size={12}/></button></footer>
  </section>
}
