import { ComposerRequestControls, type ComposerRequestControlsProps } from './ComposerRequestControls'
import { ComposerModelControl } from './choices'
import type { Session } from '../../../types'

type Modes = 'automationMode' | 'effortLevel' | 'reasoningEffort' | 'contextMode' | 'chatTransportMode'
type Props = Omit<ComposerRequestControlsProps, Modes> & Partial<Pick<ComposerRequestControlsProps, Modes>> & {
  session: Pick<Session, 'automation_mode' | 'effort_level' | 'reasoning_effort' | 'context_mode' | 'chat_transport_mode'>
  workspaceChatId: string
  conversationUrl?: string
  requestActive: boolean
}

export function ComposerSessionControls({ session, workspaceChatId, conversationUrl, requestActive, ...controls }: Props) {
  const chatTransportMode = controls.chatTransportMode || session.chat_transport_mode || 'scraper'
  return <>
    <ComposerRequestControls {...controls}
      automationMode={controls.automationMode || session.automation_mode || 'manual'}
      effortLevel={controls.effortLevel || session.effort_level || 'high'}
      reasoningEffort={controls.reasoningEffort || session.reasoning_effort || 'high'}
      contextMode={controls.contextMode || session.context_mode || 'full'}
      chatTransportMode={chatTransportMode} />
    <ComposerModelControl workspaceChatId={workspaceChatId} url={conversationUrl} disabled={Boolean(controls.busy) || requestActive || chatTransportMode === 'manual'} />
  </>
}
