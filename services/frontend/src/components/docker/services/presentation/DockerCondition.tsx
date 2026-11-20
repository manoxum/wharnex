import { translate as uiText } from '../../../../lib/workspace/localization'
import { dockerConditionLabel, dockerStateTone } from './dockerState'

const tones = { running: 'text-whx-running', warning: 'text-whx-warning', error: 'text-whx-danger', stopped: 'text-whx-faint' }
export function DockerStateDot({ tone }: { tone: keyof typeof tones }) {
  return <span className={`size-1.5 shrink-0 rounded-full bg-current ${tones[tone]}`} aria-hidden="true"/>
}
export function DockerCondition({ state }: { state: string }) {
  return <span className={`shrink-0 font-mono text-whx-caption font-medium ${tones[dockerStateTone(state)]}`}>{uiText(dockerConditionLabel(state))}</span>
}
