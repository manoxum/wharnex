import type { ContextMode } from '../../../types'
import { Icon } from '../../presentation/chrome/Icon'
import { ComposerSelectChoice } from './choices'

const options = [{ value: 'partial', label: 'Parcial' }, { value: 'full', label: 'Full' }] as const

export function ComposerContextModeControl({ mode, disabled, onChange }: {
  mode: ContextMode
  disabled: boolean
  onChange?: (mode: ContextMode) => void
}) {
  return <ComposerSelectChoice label="Modalidade de contexto"
    title="Contexto · Parcial envia mapas e acrescenta ficheiros pedidos pelo GPT; Full envia todo o contexto elegível"
    icon={<Icon name="package" size={12} />} value={mode} options={options} disabled={disabled} onChange={onChange} />
}
