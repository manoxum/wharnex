import { ComposerRequestControls, type ComposerRequestControlsProps } from './ComposerRequestControls'
import { ComposerModelControl } from './choices'
import type { Session } from '../../../types'
import { CodexEngineControl, type EngineControlProps } from '../../codex/controls/engine'

type Modes = 'automationMode' | 'effortLevel' | 'reasoningEffort' | 'contextMode' | 'chatTransportMode'
type Props = Omit<ComposerRequestControlsProps, Modes> & Partial<Pick<ComposerRequestControlsProps, Modes>> & Partial<EngineControlProps> & {
  session: Pick<Session, 'automation_mode' | 'effort_level' | 'reasoning_effort' | 'context_mode' | 'chat_transport_mode'>
  workspaceChatId: string
  conversationUrl?: string
  requestActive: boolean
}

export function ComposerSessionControls({ session, workspaceChatId, conversationUrl, requestActive, engine = 'chatgpt', onEngine, codexModel, onCodexModel, codexEffort, onCodexEffort, codexPermission, onCodexPermission, projectPath, ...controls }: Props) {
  const chatTransportMode = controls.chatTransportMode || session.chat_transport_mode || 'scraper'
  return <>
    {projectPath && <CodexEngineControl projectPath={projectPath} engine={engine} onEngine={onEngine} codexModel={codexModel} onCodexModel={onCodexModel} codexEffort={codexEffort} onCodexEffort={onCodexEffort} codexPermission={codexPermission} onCodexPermission={onCodexPermission} disabled={Boolean(controls.busy) || requestActive}/>}
    {engine !== 'codex' && <ComposerRequestControls {...controls}
      automationMode={controls.automationMode || session.automation_mode || 'manual'}
      effortLevel={controls.effortLevel || session.effort_level || 'high'}
      reasoningEffort={controls.reasoningEffort || session.reasoning_effort || 'high'}
      contextMode={controls.contextMode || session.context_mode || 'full'}
      chatTransportMode={chatTransportMode} />}
    {engine !== 'codex' && <ComposerModelControl workspaceChatId={workspaceChatId} url={conversationUrl} disabled={Boolean(controls.busy) || requestActive || chatTransportMode === 'manual'} />}
  </>
}
