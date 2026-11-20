import { translate as uiText, interfaceLocale } from '../../../lib/workspace/localization'
import { useEffect, useRef, type CSSProperties } from 'react'
import { attentionPreviewItems, summarizeAttention, type AttentionItem } from '../../../lib/attention/center/attentionCenter'
import { AttentionList } from './AttentionList'
import { Icon } from '../../presentation/chrome/Icon'


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
  const countFormat = new Intl.NumberFormat(interfaceLocale())
  const rootRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const summary = summarizeAttention(items)
  const preview = attentionPreviewItems(items)

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

  return <section ref={rootRef} id="agent-attention-popover" className="agent-attention-popover text-whx-body" style={position} role="dialog" aria-modal="false" aria-label={uiText("Alertas ativos")}>
    <header className="!min-h-10 !px-3 !py-2">
      <div className="agent-attention-popover-heading">
        <span className="agent-attention-popover-symbol" aria-hidden="true"><Icon name={summary.urgent ? 'shield' : 'bell'} size={16}/></span>
        <div className="agent-attention-popover-heading-copy">
          <h2 id="agent-attention-popover-title" className="!m-0 text-whx-title font-semibold leading-snug">{uiText("Centro de Alertas")}</h2>
        </div>
      </div>
      <button ref={closeRef} type="button" className="agent-attention-popover-close !size-8 text-whx-label" onClick={onClose} aria-label={uiText("Fechar Centro de Alertas")} title={uiText("Fechar")}><Icon name="close" size={13}/></button>
    </header>
    <div className="agent-attention-popover-metrics" aria-label={uiText("Resumo dos alertas")}>
      <span><b className="font-mono text-whx-title font-medium">{countFormat.format(summary.total)}</b><small className="text-whx-caption leading-tight">{summary.total === 1 ? uiText("Ativo") : uiText("Ativos")}</small></span>
      <span className={summary.urgent ? 'danger' : ''}><b className="font-mono text-whx-title font-medium">{countFormat.format(summary.urgent)}</b><small className="text-whx-caption leading-tight">{summary.urgent === 1 ? uiText("Urgente") : uiText("Urgentes")}</small></span>
      <span><b className="font-mono text-whx-title font-medium">{countFormat.format(summary.actionable)}</b><small className="text-whx-caption leading-tight">{uiText("Com ação")}</small></span>
    </div>
    <div className="agent-attention-popover-list">
      {preview.length
        ? <AttentionList items={preview} activeChatId={activeChatId} busy={busy} density="compact" onOpen={onOpen} onAction={onAction}/>
        : <div className="agent-drawer-empty attention-empty"><Icon name="check" size={18}/><strong>{uiText("Nada requer atenção")}</strong></div>}
    </div>
    <footer className="text-whx-label"><button type="button" onClick={onOpenAll} aria-label={uiText("Ver todos os alertas")}><span>{uiText("Abrir centro de alertas")}</span><span className="agent-attention-popover-footer-count text-whx-caption">{countFormat.format(summary.total)}</span><Icon name="arrow-right" size={12}/></button></footer>
  </section>
}
