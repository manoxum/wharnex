import { WorkbenchTabs } from '../../presentation/tabs'
import { useState, type ComponentProps } from 'react'
import { promptDialog } from '../../../lib/desktop/bridge/appDialog'
import { loadChat } from '../../../lib/chat/history/workspaceMemory'
import { ChatPanel } from './ChatPanel'
import { Icon } from '../../presentation/chrome/Icon'
import { InternalWindow } from '../../workspace/window/InternalWindow'
import { MarkdownContent } from '../../presentation/content/MarkdownContent'

type ChatManagementDrawerProps = {
  projectPath: string
  savedChats: ComponentProps<typeof ChatPanel>['archivedChats']
  archivedChats: ComponentProps<typeof ChatPanel>['archivedChats']
  busy: boolean
  onRestoreSaved?: (chatId: string) => Promise<void>
  onArchiveSaved?: (chatId: string) => Promise<void>
  onRestoreArchived: ComponentProps<typeof ChatPanel>['onRestoreChat']
  onDeleteArchived: ComponentProps<typeof ChatPanel>['onDeleteArchivedChat']
  onRename: ComponentProps<typeof ChatPanel>['onRenameChat']
  onGenerate: ComponentProps<typeof ChatPanel>['onGenerateChatTitle']
  onClose: () => void
}

export function ChatManagementDrawer({ projectPath, savedChats, archivedChats, busy, onRestoreSaved, onArchiveSaved, onRestoreArchived, onDeleteArchived, onRename, onGenerate, onClose }: ChatManagementDrawerProps) {
  const [tab, setTab] = useState<'saved' | 'archived'>(() => savedChats.length ? 'saved' : 'archived')
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState<string>()
  const chats = tab === 'saved' ? savedChats : archivedChats
  const normalizedQuery = query.trim().toLowerCase()
  const visible = chats.filter((chat) => chat.title.toLowerCase().includes(normalizedQuery))
  const previewChat = chats.find((chat) => chat.id === preview)
  const previewItems = previewChat ? loadChat(projectPath, previewChat.id) : []
  const visibleLabel = normalizedQuery ? `${visible.length} de ${chats.length}` : `${chats.length} ${chats.length === 1 ? 'chat' : 'chats'}`
  const emptyTitle = chats.length ? 'Nenhum resultado' : tab === 'saved' ? 'Ainda não há chats guardados' : 'Ainda não há chats arquivados'
  const emptyDetail = chats.length ? 'Tente pesquisar por outro título.' : tab === 'saved' ? 'Guardar suspende o chat e deixa as execuções em standby até reativar ou arquivar.' : 'Os chats fechados ficam organizados aqui sem perder o histórico.'
  const setManagementTab = (next: 'saved' | 'archived') => { setTab(next); setQuery(''); setPreview(undefined) }

  return <section className="agent-archive-drawer" aria-label="Gestão de chats">
    <header className="agent-drawer-heading agent-archive-heading"><div><span className="panel-kicker">Workspace</span><div className="agent-archive-heading-row"><strong>Gestão de chats</strong><span className="agent-archive-count">{savedChats.length + archivedChats.length}</span></div></div><button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar Gestão de chats"><Icon name="close" size={13}/></button></header>
    <WorkbenchTabs label="Estado dos chats" value={tab} onChange={setManagementTab} items={[
      { id: 'saved', label: 'Guardados', icon: 'save', badge: savedChats.length },
      { id: 'archived', label: 'Arquivados', icon: 'archive', badge: archivedChats.length },
    ]}/>
    <div className="agent-archive-toolbar"><label className="panel-search-field archive-search"><Icon name="search" size={13}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === 'saved' ? 'Pesquisar chats guardados' : 'Pesquisar chats arquivados'}/></label><span className="agent-archive-filter-count" aria-live="polite">{visibleLabel}</span></div>
    <div className="agent-archive-list">
      {visible.length ? visible.map((chat) => {
        const stateAt = tab === 'saved' ? (chat.savedAt || chat.updatedAt) : (chat.archivedAt || chat.updatedAt)
        return <article className="agent-archive-item" key={chat.id} onClick={() => setPreview(chat.id)}>
          <div className="agent-archive-copy"><div className="agent-archive-card-title"><strong>{chat.title}</strong><span className={chat.chatgptUrl ? 'agent-archive-link linked' : 'agent-archive-link local'}>{chat.chatgptUrl ? 'ChatGPT' : 'Local'}</span></div><div className="agent-archive-meta"><span><small>Início</small><time dateTime={chat.createdAt}>{new Date(chat.createdAt).toLocaleString()}</time></span><span><small>{tab === 'saved' ? 'Guardado' : 'Encerramento'}</small><time dateTime={stateAt}>{new Date(stateAt).toLocaleString()}</time></span></div></div>
          <div className="agent-archive-actions">
            <button type="button" disabled={busy} onClick={(event) => { event.stopPropagation(); void promptDialog({ title: 'Renomear chat', inputLabel: 'Novo nome', initialValue: chat.title, confirmLabel: 'Renomear' }).then((title) => { if (title) return onRename?.(chat.id, title) }) }} aria-label={`Renomear ${chat.title}`} title="Renomear"><Icon name="rename" size={13}/></button>
            {tab === 'archived' && <button type="button" disabled={busy || !chat.chatgptUrl} onClick={(event) => { event.stopPropagation(); void onGenerate?.(chat.id) }} aria-label={`Gerar nome para ${chat.title}`} title="Usar o título contextual gerado pelo ChatGPT"><Icon name="agent" size={13}/></button>}
            {tab === 'saved' ? <><button type="button" disabled={busy || !onRestoreSaved} onClick={(event) => { event.stopPropagation(); void onRestoreSaved?.(chat.id) }} aria-label={`Reativar ${chat.title}`} title="Reativar"><Icon name="refresh" size={13}/></button><button type="button" disabled={busy || !onArchiveSaved} onClick={(event) => { event.stopPropagation(); void onArchiveSaved?.(chat.id) }} aria-label={`Arquivar ${chat.title}`} title="Arquivar"><Icon name="archive" size={13}/></button></> : <button type="button" className="danger" disabled={busy} onClick={(event) => { event.stopPropagation(); void onDeleteArchived(chat.id) }} aria-label={`Eliminar definitivamente ${chat.title}`} title="Eliminar definitivamente"><Icon name="trash" size={13}/></button>}
          </div>
        </article>
      }) : <div className="agent-archive-empty"><span className="agent-archive-empty-icon"><Icon name="folder" size={18}/></span><strong>{emptyTitle}</strong><p>{emptyDetail}</p></div>}
    </div>
    {previewChat && <InternalWindow title={`Pré-visualização de ${previewChat.title}`} onClose={() => setPreview(undefined)} layerClassName="archived-preview-backdrop"><section className="archived-preview" role="dialog" aria-modal="false" aria-label={`Pré-visualização de ${previewChat.title}`}><header><div><span className="panel-kicker">{tab === 'saved' ? 'Em standby' : 'Somente leitura'}</span><h2>{previewChat.title}</h2><p>{new Date(previewChat.createdAt).toLocaleString()} — {new Date(tab === 'saved' ? (previewChat.savedAt || previewChat.updatedAt) : (previewChat.archivedAt || previewChat.updatedAt)).toLocaleString()}</p></div><button className="icon-button light" onClick={() => setPreview(undefined)} aria-label="Fechar pré-visualização"><Icon name="close" size={14}/></button></header><div className="archived-preview-stream">{previewItems.map((item) => <article key={item.id} className={`archived-preview-message ${item.source || item.role}`}><small>{item.source === 'chatgpt' ? 'ChatGPT' : item.source === 'wharness' ? 'WHX' : 'Você'} · {item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</small><MarkdownContent markdown={item.text}/></article>)}</div>{tab === 'saved' ? <footer><span>Execuções e automação estão em standby. A conversa remota permanece intacta.</span><div className="agent-chat-management-preview-actions"><button className="secondary-button" disabled={busy || !onArchiveSaved} onClick={() => void onArchiveSaved?.(previewChat.id)}><Icon name="archive" size={13}/> Arquivar</button><button className="apply-button" disabled={busy || !onRestoreSaved} onClick={() => void onRestoreSaved?.(previewChat.id)}><Icon name="refresh" size={13}/> Reativar chat</button></div></footer> : <footer><span>Envio e processamento permanecem bloqueados até restaurar.</span><button className="apply-button" disabled={busy} onClick={() => void onRestoreArchived(previewChat.id)}><Icon name="refresh" size={13}/> Restaurar chat</button></footer>}</section></InternalWindow>}
  </section>
}
