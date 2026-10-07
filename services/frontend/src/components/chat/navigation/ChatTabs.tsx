import type { DragEvent, HTMLAttributes, KeyboardEvent, MouseEvent, Ref } from 'react'
import type { ChatPanelProps } from '../panel/panelTypes'
import { Icon } from '../../presentation/chrome/Icon'
import { chatGroupChrome, chatActionChrome } from './chatTabChrome'
import { TabBar, TabButton } from '../../presentation/tabs'

type Chat = ChatPanelProps['chats'][number]
export function ChatTabs({ chats, activeId, busy, onSelect, onArchive, onSave, rootRef, onScroll, draggedId, dropTargetId, onDragStart, onDragEnter, onDrop, onContextMenu, onDragEnd, onTabKeyDown }: {
  chats: Chat[]; activeId: string; busy?: boolean; onSelect: (id: string) => void; onArchive: (id: string) => void; onSave?: (id: string) => void
  rootRef?: Ref<HTMLDivElement>; onScroll?: HTMLAttributes<HTMLDivElement>['onScroll']; draggedId?: string; dropTargetId?: string
  onDragStart?: (event: DragEvent<HTMLDivElement>, id: string) => void; onDragEnter?: (id: string) => void
  onDrop?: (event: DragEvent<HTMLDivElement>, id: string) => void; onContextMenu?: (event: MouseEvent<HTMLDivElement>, id: string) => void
  onDragEnd?: (event: DragEvent<HTMLDivElement>, id: string) => void; onTabKeyDown?: (event: KeyboardEvent<HTMLButtonElement>, id: string) => void
}) {
  return <TabBar appearance="conversation" label="Conversas abertas" className="min-w-0 flex-1" ref={rootRef} onScroll={onScroll}>
    {chats.map((chat) => <div key={chat.id} data-chat-id={chat.id} draggable={Boolean(onDragStart)}
      data-resource-tab data-selected={chat.id === activeId} className={`chat-tab-group ${chatGroupChrome} ${draggedId === chat.id ? 'opacity-55 [&_[role=tab]]:cursor-grabbing' : ''} ${dropTargetId === chat.id ? 'outline outline-1 outline-dashed outline-[var(--theme-accent)] outline-offset-[-2px]' : ''}`}
      onDragStart={(event) => onDragStart?.(event, chat.id)} onDragEnter={() => onDragEnter?.(chat.id)}
      onDragOver={(event) => { if (draggedId && draggedId !== chat.id) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }}
      onDrop={(event) => onDrop?.(event, chat.id)} onContextMenu={(event) => onContextMenu?.(event, chat.id)} onDragEnd={(event) => onDragEnd?.(event, chat.id)}>
      <TabButton label={chat.title} appearance="conversation" icon={<i className={chat.chatgptUrl ? 'chat-link-dot linked' : 'chat-link-dot'} aria-hidden="true"/>} selected={chat.id === activeId} disabled={busy} onClick={() => onSelect(chat.id)}
        onKeyDown={(event) => onTabKeyDown?.(event, chat.id)} title={`${chat.title}\n${chat.chatgptUrl ? `ChatGPT: ${chat.chatgptUrl}` : 'ChatGPT ainda não vinculado'}${onDragStart ? '\nArraste para reordenar · Alt+←/→' : ''}`}/>
      {onSave && <button type="button" className={`${chatActionChrome} hover:bg-[var(--theme-accent-soft)] hover:text-whx-accent`} disabled={busy} onClick={() => onSave(chat.id)} title={`Guardar ${chat.title} em standby`} aria-label={`Guardar chat ${chat.title}`}><Icon name="save" size={11}/></button>}
      <button type="button" className={`${chatActionChrome} hover:bg-[#e8ece4] hover:text-[#52654a] [[data-theme=dark]_&]:hover:bg-[#34221f] [[data-theme=dark]_&]:hover:text-[#e89b91]`} disabled={busy} onClick={() => onArchive(chat.id)} title={`Fechar e arquivar ${chat.title}`} aria-label={`Fechar e arquivar chat ${chat.title}`}><Icon name="close" size={11}/></button>
    </div>)}
  </TabBar>
}
