import type { ComponentProps, Ref } from 'react'
import { ChatPanel, type ChatPanelHandle } from '../../chat/panel/ChatPanel'
import type { ChatViewportStore } from '../../chat/panel/useProgressiveChatHistory'
import type { Inspector } from '../../editor/inspector/Inspector'
import { ChatExecutionApproval } from '../../execution/consent'
import { translate as uiText } from '../../../lib/workspace/localization'

type Props = {
  chatProps: ComponentProps<typeof ChatPanel>
  inspectorProps: ComponentProps<typeof Inspector>
  panelRef: Ref<ChatPanelHandle>
  viewportStore: ChatViewportStore
  onExportChat?: () => Promise<void>
}

export function AgentChatSurface({ chatProps, inspectorProps, panelRef, viewportStore, onExportChat }: Props) {
  const ownsSession = chatProps.session.id === inspectorProps.session.id && chatProps.chats.some((chat) => chat.id === chatProps.activeChatId && chat.sessionId === inspectorProps.session.id)
  const approval = ownsSession ? <ChatExecutionApproval key={`${inspectorProps.session.id}:${inspectorProps.session.plan?.plan_id}`} session={inspectorProps.session} busy={inspectorProps.busy} onExecute={inspectorProps.onExecute} onApproveDebug={inspectorProps.onApproveDebug} onRejectExecutionPlan={inspectorProps.onRejectExecutionPlan}/> : null
  return <ChatPanel ref={panelRef} key={chatProps.activeChatId} {...chatProps} composerHint={chatProps.composerHint || uiText('Enter envia · Shift+Enter cria uma nova linha')} historyViewportStore={viewportStore} embedded hideSwitcher onExportChat={onExportChat} executionApproval={approval}/>
}
