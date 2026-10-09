import { ChatTabs } from '../navigation'
import type { Dispatch, SetStateAction, ComponentProps } from 'react'
import type { ChatPanelProps } from './panelTypes'
import { Icon } from '../../presentation/chrome/Icon'
import { StatusPill } from '../../presentation/chrome/StatusPill'
import { stateLabel } from '../../../lib/execution/recovery/risk'
import { BundleExchangeBar } from '../../artifacts/explorer/BundleExplorer'
import { formatMessageTime } from './noticePresentation'

type NavigationProps = Pick<ChatPanelProps, 'session' | 'embedded' | 'hideSwitcher' | 'composerOnly' | 'busy' | 'chats' | 'archivedChats' | 'activeChatId' | 'onExportChat' | 'onNewChat' | 'onRestoreChat' | 'onSelectChat' | 'onSaveChat' | 'onArchiveChat' | 'onDeleteArchivedChat'> & {
  contextLabel: string
  contextStateTone: ComponentProps<typeof StatusPill>['tone']
  contextIdentityCopied: boolean
  copyContextIdentity: () => Promise<void>
  archiveOpen: boolean
  setArchiveOpen: Dispatch<SetStateAction<boolean>>
}

export function ChatNavigation({ session, embedded, hideSwitcher, composerOnly, busy, chats, archivedChats, activeChatId, onExportChat, onNewChat, onRestoreChat, onSelectChat, onSaveChat, onArchiveChat, onDeleteArchivedChat, contextLabel, contextStateTone, contextIdentityCopied, copyContextIdentity, archiveOpen, setArchiveOpen }: NavigationProps) {
  return <>
    {!composerOnly && <header className={`panel-header chat-header ${embedded ? 'embedded' : ''}`}>
      <div className="chat-header-context" aria-label={contextLabel}>
        <span className="chat-header-context-icon"><Icon name="shield" size={13}/></span>
        <strong title={contextLabel}>{contextLabel}</strong>
        <StatusPill tone={contextStateTone}>{stateLabel(session.state)}</StatusPill>
        <div className="chat-header-context-actions">
          <button type="button" className="chat-header-context-copy-button" onClick={() => void copyContextIdentity()} aria-label="Copiar hash e ID do chat" title={contextIdentityCopied ? 'Hash e ID copiados' : 'Copiar hash completo e ID do chat'}><Icon name={contextIdentityCopied ? 'check' : 'copy'} size={12}/></button>
          {onExportChat && <button type="button" className="chat-export-button" disabled={busy} onClick={() => void onExportChat()} aria-label="Exportar ZIP" title="Exportar chat completo, execuções e bundles em ZIP"><Icon name="download" size={13}/></button>}
        </div>
      </div>
      <BundleExchangeBar sessionId={session.id} artifacts={session.artifacts} requestLineages={session.request_lineages} />
    </header>}

    {!composerOnly && !hideSwitcher && <div className="chat-switcher" aria-label="Conversas do Wharnex">
      <button className="chat-new-button" disabled={busy} onClick={() => void onNewChat()} title="Novo chat" aria-label="Novo chat"><Icon name="plus" size={14}/></button>
      {archivedChats.length > 0 && <button className="chat-new-button chat-reopen-button" disabled={busy} onClick={() => void onRestoreChat(archivedChats[0].id)} title={`Reabrir último chat fechado: ${archivedChats[0].title}`} aria-label="Reabrir último chat fechado"><Icon name="refresh" size={13}/></button>}
      <ChatTabs chats={chats} activeId={activeChatId} busy={busy} onSelect={(id) => void onSelectChat(id)} onArchive={(id) => void onArchiveChat(id)} onSave={onSaveChat ? (id) => void onSaveChat(id) : undefined}/>

      {!embedded && <button className={archiveOpen ? 'chat-archive-toggle active' : 'chat-archive-toggle'} disabled={busy && !archiveOpen} onClick={() => setArchiveOpen((current) => !current)} title="Chats fechados"><Icon name="folder" size={13}/><span>Arquivados</span>{archivedChats.length > 0 && <b>{archivedChats.length}</b>}</button>}
    </div>}


    {!composerOnly && !embedded && archiveOpen && <div className="chat-archive-panel">
      <div className="chat-archive-heading"><div><strong>Chats arquivados</strong><span>Fechar um chat preserva o histórico, o vínculo ChatGPT e os anexos locais.</span></div><button className="icon-button light" onClick={() => setArchiveOpen(false)} title="Fechar área de arquivados"><Icon name="close" size={13}/></button></div>
      {archivedChats.length ? <div className="chat-archive-list">{archivedChats.map((chat) => <div className="chat-archive-row" key={chat.id}>
        <div className="chat-archive-copy"><strong>{chat.title}</strong><span>{chat.chatgptUrl ? 'ChatGPT vinculado' : 'Sem vínculo ChatGPT'} · fechado em {formatMessageTime(chat.updatedAt)}</span></div>
        <div className="chat-archive-actions"><button className="text-button" disabled={busy} onClick={() => void onRestoreChat(chat.id)}><Icon name="refresh" size={12}/> Reabrir</button><button className="archive-delete-button" disabled={busy} onClick={() => void onDeleteArchivedChat(chat.id)} title="Eliminar definitivamente"><Icon name="trash" size={13}/></button></div>
      </div>)}</div> : <div className="chat-archive-empty">Nenhum chat fechado.</div>}
    </div>}

  </>
}
