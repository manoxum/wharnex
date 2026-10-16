import type { ChatPanelProps } from '../../chat/panel/panelTypes'
import { ComposerSessionControls } from '../../chat/composer/ComposerSessionControls'

type Props = Pick<ChatPanelProps, 'session' | 'activeChatId' | 'chats' | 'taskInFlight' | 'preparedAttachmentCount' | 'automationMode' | 'effortLevel' | 'reasoningEffort' | 'chatTransportMode' | 'busy' | 'onAutomationMode' | 'onEffortLevel' | 'onReasoningEffort' | 'onContextMode' | 'onChatTransportMode' | 'engine' | 'onEngine' | 'codexModel' | 'onCodexModel' | 'codexEffort' | 'onCodexEffort' | 'codexPermission' | 'onCodexPermission'>
export function ChatComposerSessionControls({ activeChatId, chats, taskInFlight, preparedAttachmentCount, ...controls }: Props) {
  const chatId = activeChatId || controls.session.chat_id || ''
  return <ComposerSessionControls {...controls} progressive workspaceChatId={chatId} projectPath={controls.session.project_path}
    conversationUrl={chats.find((chat) => chat.id === chatId)?.chatgptUrl}
    requestActive={Boolean(taskInFlight || preparedAttachmentCount)}/>
}
