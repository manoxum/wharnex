import { useState } from 'react'
import { summarizeAttention, type AttentionItem } from '../../../../lib/attention/center/attentionCenter'
import { AttentionList } from '../../../attention/center/AttentionList'
import { Icon } from '../../../presentation/chrome/Icon'

export function AttentionCenterDrawer({ items, historyItems, activeChatId, busy, onOpen, onAction, onClose }: { items: AttentionItem[]; historyItems: AttentionItem[]; activeChatId: string; busy: boolean; onOpen: (item: AttentionItem) => Promise<void>; onAction: (item: AttentionItem) => Promise<void>; onClose: () => void }) {
  const [filter, setFilter] = useState<'all' | 'urgent' | 'actionable' | 'history'>('all')
  const summary = summarizeAttention(items)
  const showingHistory = filter === 'history'
  const filteredItems = showingHistory ? historyItems : filter === 'urgent' ? items.filter((item) => item.tone === 'danger') : filter === 'actionable' ? items.filter((item) => Boolean(item.action)) : items
  return <section className="attention-center-drawer" aria-label="Centro de notificações">
    <header className="agent-drawer-heading">
      <div className="attention-center-heading">
        <span className="attention-center-symbol" aria-hidden="true"><Icon name="bell" size={17}/></span>
        <div><span className="panel-kicker">Atenção global</span><strong>Centro de Alertas</strong><small>Priorize bloqueios e ações sem sair do projeto.</small></div>
      </div>
      <button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar Centro de Alertas"><Icon name="close" size={13}/></button>
    </header>
    <div className="attention-center-summary" role="status" aria-live="polite" aria-atomic="true">
      <span><b>{summary.total}</b> {summary.total === 1 ? 'alerta ativo' : 'alertas ativos'}</span>
      <span className={summary.urgent ? 'danger' : ''}><b>{summary.urgent}</b> {summary.urgent === 1 ? 'urgente' : 'urgentes'}</span>
      <span><b>{summary.actionable}</b> com ação</span>
      <span><b>{summary.chats}</b> {summary.chats === 1 ? 'chat afetado' : 'chats afetados'}</span>
    </div>
    <nav className="attention-center-filters" aria-label="Filtrar Alertas">
      <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Todos <b>{summary.total}</b></button>
      <button type="button" aria-pressed={filter === 'urgent'} onClick={() => setFilter('urgent')}>Urgentes <b>{summary.urgent}</b></button>
      <button type="button" aria-pressed={filter === 'actionable'} onClick={() => setFilter('actionable')}>Com Ação <b>{summary.actionable}</b></button>
      <button type="button" aria-pressed={filter === 'history'} onClick={() => setFilter('history')}>Histórico <b>{historyItems.length}</b></button>
    </nav>
    <div className="attention-center-list">
      {filteredItems.length ? <AttentionList items={filteredItems} activeChatId={activeChatId} busy={busy} density="full" onOpen={onOpen} onAction={onAction}/> : <div className="agent-drawer-empty attention-empty"><Icon name="check" size={18}/><strong>{showingHistory ? 'Histórico vazio' : items.length ? 'Nenhum alerta neste filtro' : 'Nada requer atenção'}</strong><span>{showingHistory ? 'As tarefas concluídas que abrir ficam guardadas aqui.' : items.length ? 'Escolha outro filtro para rever os alertas ativos.' : 'Alertas de todos os chats abertos deste projeto aparecerão aqui.'}</span></div>}
    </div>
  </section>
}
