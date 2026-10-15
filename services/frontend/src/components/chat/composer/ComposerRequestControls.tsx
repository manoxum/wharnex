import type { AutomationMode, ChatRequestMode, ChatTransportMode, ContextMode, EffortLevel, ReasoningEffort } from '../../../types'
import { Icon } from '../../presentation/chrome/Icon'
import { ComposerContextModeControl } from './ComposerContextModeControl'
import { ComposerReasoningControl } from './choices'

export type ComposerRequestControlsProps = {
  automationMode: AutomationMode
  effortLevel: EffortLevel
  reasoningEffort: ReasoningEffort
  contextMode: ContextMode
  chatTransportMode: ChatTransportMode
  showChatGPTTransport?: boolean
  busy?: boolean
  onAutomationMode?: (mode: AutomationMode) => void
  onEffortLevel?: (level: EffortLevel) => void
  onReasoningEffort?: (effort: ReasoningEffort) => void
  onContextMode?: (mode: ContextMode) => void
  onChatTransportMode?: (mode: ChatTransportMode) => void
}

export function ComposerRequestControls({
  automationMode,
  effortLevel,
  reasoningEffort,
  contextMode,
  chatTransportMode,
  showChatGPTTransport = true,
  busy = false,
  onAutomationMode,
  onEffortLevel,
  onReasoningEffort,
  onContextMode,
  onChatTransportMode,
}: ComposerRequestControlsProps) {
  return <>
    <span className="composer-mode-group" role="group" aria-label="Automação de execução">
      <button type="button" className={`composer-round-action mode-manual ${automationMode === 'manual' ? 'selected' : ''}`} disabled={busy || !onAutomationMode} aria-pressed={automationMode === 'manual'} aria-label="Manual" title="Manual · executar e aplicar mudanças apenas por ação explícita" onClick={() => onAutomationMode?.('manual')}><Icon name="plan" size={12}/></button>
      <button type="button" className={`composer-round-action mode-auto ${automationMode === 'auto' ? 'selected' : ''}`} disabled={busy || !onAutomationMode} aria-pressed={automationMode === 'auto'} aria-label="Auto" title="Auto · mudanças válidas seguem Protected e são aplicadas após verificação" onClick={() => onAutomationMode?.('auto')}><Icon name="agent" size={12}/></button>
      <button type="button" className={`composer-round-action mode-auto-approve ${automationMode === 'auto_approve' ? 'selected' : ''}`} disabled={busy || !onAutomationMode} aria-pressed={automationMode === 'auto_approve'} aria-label="Auto + Aprovar" title="Auto + Aprovar · mudanças permitidas seguem Protected e aprovações de execução elegíveis são concedidas automaticamente; reinício de auto-evolução continua explícito" onClick={() => onAutomationMode?.('auto_approve')}><Icon name="check" size={12}/></button>
    </span>
    <label className="composer-effort-picker" title="Nível de esforço · limita tentativas automáticas de resolução; após aplicar com sucesso no host, a Main Request termina">
      <span>Esforço</span>
      <select aria-label="Nível de esforço" value={effortLevel} disabled={busy || !onEffortLevel} onChange={(event) => onEffortLevel?.(event.target.value as EffortLevel)}>
        <option value="low">Low · 3</option>
        <option value="medium">Medium · 8</option>
        <option value="high">High · 15</option>
        <option value="extra_high">Extra High · 20</option>
        <option value="max">Max · 30</option>
        <option value="ultra">Ultra · 50</option>
        <option value="loop">Loop · ∞</option>
      </select>
    </label>
    <ComposerContextModeControl mode={contextMode} disabled={busy} onChange={onContextMode} />
    <ComposerReasoningControl value={reasoningEffort} disabled={busy} onChange={onReasoningEffort} />
    {showChatGPTTransport && <span className="composer-mode-group" role="group" aria-label="Transporte com o ChatGPT">
      <button type="button" className={`composer-round-action mode-scraper ${chatTransportMode === 'scraper' ? 'selected' : ''}`} disabled={busy || !onChatTransportMode} aria-pressed={chatTransportMode === 'scraper'} aria-label="Scraper" title="Scraper · o Wharnex interage diretamente com o ChatGPT" onClick={() => onChatTransportMode?.('scraper')}><Icon name="chatgpt" size={12}/></button>
      <button type="button" className={`composer-round-action mode-manual-transport ${chatTransportMode === 'manual' ? 'selected' : ''}`} disabled={busy || !onChatTransportMode} aria-pressed={chatTransportMode === 'manual'} aria-label="Manual (transporte)" title="Manual · copie o prompt e entregue o bundle de resposta manualmente" onClick={() => onChatTransportMode?.('manual')}><Icon name="clipboard" size={12}/></button>
    </span>}
  </>
}

export function ComposerPlanFirstControl({ requestMode, disabled = false, onRequestMode }: {
  requestMode: ChatRequestMode
  disabled?: boolean
  onRequestMode?: (mode: ChatRequestMode) => void
}) {
  return <button
    type="button"
    className={`composer-round-action plan-first ${requestMode === 'plan_first' ? 'selected' : ''}`}
    disabled={disabled}
    aria-pressed={requestMode === 'plan_first'}
    aria-label="Planificar antes de alterar"
    title={requestMode === 'plan_first' ? 'Plan first ativo · o Wharnex pedirá uma proposta e aguardará aprovação' : 'Planificar antes de alterar'}
    onClick={() => onRequestMode?.(requestMode === 'plan_first' ? 'direct' : 'plan_first')}
  ><Icon name="plan" size={12}/></button>
}
