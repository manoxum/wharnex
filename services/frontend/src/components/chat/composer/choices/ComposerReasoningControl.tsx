import type { ReasoningEffort } from '../../../../types'
import { Icon } from '../../../presentation/chrome/Icon'
import { ComposerSelectChoice } from './ComposerSelectChoice'

const options = [
  { value: 'instant', label: 'Instantâneo' },
  { value: 'medium', label: 'Médio' },
  { value: 'high', label: 'Elevado' },
] as const

export function ComposerReasoningControl({ value, disabled, onChange }: {
  value: ReasoningEffort
  disabled: boolean
  onChange?: (effort: ReasoningEffort) => void
}) {
  return <ComposerSelectChoice label="Esforço de raciocínio" title="Inteligência · esforço de raciocínio aplicado pelo ChatGPT antes do envio"
    icon={<Icon name="sparkles" size={12} />} value={value} options={options} disabled={disabled} onChange={onChange} />
}
