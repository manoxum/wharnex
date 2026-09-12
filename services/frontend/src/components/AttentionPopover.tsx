import { useEffect, useRef } from 'react'
import { attentionPreviewItems, summarizeAttention, type AttentionItem } from '../lib/attentionCenter'
import { AttentionList } from './AttentionList'
import { Icon } from './Icon'

const countFormat = new Intl.NumberFormat('pt-PT')

export function AttentionPopover({ items, activeChatId, busy, onOpen, onAction, onOpenAll, onClose }: {
  items: AttentionItem[]
  activeChatId: string
  busy: boolean
  onOpen: (item: AttentionItem) => Promise<void>
  onAction: (item: AttentionItem) => Promise<void>
  onOpenAll: () => void
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const summary = summarizeAttention(items)
  const preview = attentionPreviewItems(items)
  const hiddenCount = summary.total - preview.length

  // Opening the popup is an explicit user action. Land keyboard users on its
  // close affordance; Escape and that affordance return focus to the trigger.
  useEffect(() => { closeRef.current?.focus() }, [])

  return <section id="agent-attention-popover" className="agent-attention-popover" role="dialog" aria-modal="false" aria-label="Alertas ativos" aria-describedby="agent-attention-popover-description" data-chatgpt-overlay-blocker="true">
    <header>
      <div className="agent-attention-popover-heading">
        <span>Triagem do Projeto</span>
        <h2 id="agent-attention-popover-title">Centro de Alertas</h2>
        <p id="agent-attention-popover-description">Ações concretas primeiro; abra um alerta para ver todo o contexto.</p>
      </div>
      <button ref={closeRef} type="button" className="agent-attention-popover-close" onClick={onClose} aria-label="Fechar Centro de Alertas" title="Fechar"><Icon name="close" size={13}/></button>
    </header>
    <div className="agent-attention-popover-metrics" aria-label="Resumo dos alertas">
      <span><b>{countFormat.format(summary.total)}</b> {summary.total === 1 ? 'Alerta' : 'Alertas'}</span>
      <span className={summary.urgent ? 'danger' : ''}><b>{countFormat.format(summary.urgent)}</b> {summary.urgent === 1 ? 'Urgente' : 'Urgentes'}</span>
      <span><b>{countFormat.format(summary.actionable)}</b> com ação</span>
    </div>
    <div className="agent-attention-popover-list">
      <AttentionList items={preview} activeChatId={activeChatId} busy={busy} density="compact" onOpen={onOpen} onAction={onAction}/>
      {hiddenCount > 0 ? <p className="agent-attention-popover-overflow">Mais {countFormat.format(hiddenCount)} {hiddenCount === 1 ? 'alerta está disponível' : 'alertas estão disponíveis'} no painel completo.</p> : null}
    </div>
    <footer><button type="button" onClick={onOpenAll} aria-label="Ver todos os alertas"><Icon name="bell" size={13}/> Ver todos os {countFormat.format(summary.total)} alertas <Icon name="arrow-right" size={12}/></button></footer>
  </section>
}
