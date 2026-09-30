import type { ChatArtifactKind } from '../../../../types'
import { Icon } from '../../../presentation/chrome/Icon'

export function artifactIcon(kind: ChatArtifactKind) {
  return kind === 'context' ? <Icon name="workspace" size={11}/> : kind === 'prompt' ? <Icon name="plan" size={11}/> : kind === 'result' ? <Icon name="download" size={11}/> : <Icon name="shield" size={11}/>
}
export function artifactLabel(kind: ChatArtifactKind) { return kind === 'context' ? 'contexto' : kind === 'prompt' ? 'prompt' : kind === 'result' ? 'resultado' : 'erro' }
