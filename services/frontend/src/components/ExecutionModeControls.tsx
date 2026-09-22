import type { ExecutionMode } from '../types'
import { Icon } from './Icon'

export function ExecutionModeControls({ mode, busy, selfEvolution, onChange }: {
  mode: ExecutionMode
  busy: boolean
  selfEvolution: boolean
  onChange?: (mode: ExecutionMode) => void
}) {
  return <span className="composer-mode-group" role="group" aria-label="Proteção de execução">
    <button type="button" className={`composer-round-action mode-protected ${mode === 'protected' ? 'selected' : ''}`} disabled={busy || !onChange} aria-pressed={mode === 'protected'} aria-label="Protected" title="Protected · executar e verificar primeiro na sandbox" onClick={() => onChange?.('protected')}><Icon name="shield" size={12}/></button>
    <button type="button" className={`composer-round-action mode-unprotected ${mode === 'unprotected' ? 'selected' : ''}`} disabled={busy || !onChange || selfEvolution} aria-pressed={mode === 'unprotected'} aria-label="Unprotected" title={selfEvolution ? 'Unprotected indisponível · auto-evolução do Wharnex é sempre Protected' : 'Unprotected · executar diretamente no projeto real'} onClick={() => onChange?.('unprotected')}><Icon name="external" size={12}/></button>
    <button type="button" className={`composer-round-action mode-full ${mode === 'full' ? 'selected' : ''}`} disabled={busy || !onChange || selfEvolution} aria-pressed={mode === 'full'} aria-label="Full" title={selfEvolution ? 'Full indisponível · auto-evolução do Wharnex é sempre Protected' : 'Full · host direto; comandos de alto impacto são permitidos por defeito, mas sudo continua a exigir aprovação e senha'} onClick={() => onChange?.('full')}><Icon name="terminal" size={12}/></button>
  </span>
}
