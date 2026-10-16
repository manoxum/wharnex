import type { AutomationMode, ChatTransportMode, EffortLevel } from '../../../../types'
import { ControlPopover, Field, Select, StatusBadge } from '../../../presentation/workbench'
import type { ComposerRequestControlsProps } from '../ComposerRequestControls'

export function ComposerExecutionOptions({ automationMode, effortLevel, chatTransportMode, busy, onAutomationMode, onEffortLevel, onChatTransportMode, showChatGPTTransport = true }: ComposerRequestControlsProps) {
  return <div className="inline-flex items-center gap-1">
    <StatusBadge tone={automationMode === 'auto_approve' ? 'warning' : 'neutral'} icon={automationMode === 'manual' ? 'plan' : 'play'}>{automationMode === 'manual' ? 'Manual' : automationMode === 'auto_approve' ? 'Auto + Aprovar' : 'Auto'}</StatusBadge>
    <ControlPopover label="Execução e transporte">
      <Field label="Automação" description="Aplica-se às próximas operações do agente. Protected continua a verificar as alterações antes da integração.">
        <Select aria-label="Automação de execução" value={automationMode} disabled={busy || !onAutomationMode} onChange={(event) => onAutomationMode?.(event.target.value as AutomationMode)}>
          <option value="manual">Manual · ações explícitas</option><option value="auto">Auto · executar após validação</option><option value="auto_approve">Auto + Aprovar · aprovações elegíveis</option>
        </Select>
      </Field>
      <Field label="Esforço" description="Limite de tentativas automáticas; a Inteligência controla a profundidade do raciocínio.">
        <Select aria-label="Nível de esforço" value={effortLevel} disabled={busy || !onEffortLevel} onChange={(event) => onEffortLevel?.(event.target.value as EffortLevel)}>
          <option value="low">Low · 3</option><option value="medium">Medium · 8</option><option value="high">High · 15</option><option value="extra_high">Extra High · 20</option><option value="max">Max · 30</option><option value="ultra">Ultra · 50</option><option value="loop">Loop · ∞</option>
        </Select>
      </Field>
      {showChatGPTTransport && <Field label="Transporte ChatGPT" description="O transporte manual mantém a importação e a validação normal dos bundles.">
        <Select aria-label="Transporte com o ChatGPT" value={chatTransportMode} disabled={busy || !onChatTransportMode} onChange={(event) => onChatTransportMode?.(event.target.value as ChatTransportMode)}><option value="scraper">Scraper · integrado</option><option value="manual">Manual · importar bundle</option></Select>
      </Field>}
      {automationMode === 'auto_approve' && <p className="!m-0 !text-whx-caption !leading-relaxed !text-whx-warning">Aprova automaticamente as operações elegíveis. O reinício de auto-evolução mantém a confirmação explícita.</p>}
    </ControlPopover>
  </div>
}
