import { Icon } from '../../presentation/chrome/Icon'
import { desktopBridge } from '../../../lib/desktop/bridge/desktop'
import { useCodexStatus, type CodexPermissionLevel, type PlannerEngine } from '../../../lib/codex'
import { ComposerSelectChoice } from '../../chat/composer/choices/ComposerSelectChoice'

export type EngineControlProps = {
  engine?: PlannerEngine; onEngine?: (engine: PlannerEngine) => void
  projectPath: string; codexModel?: string; onCodexModel?: (model: string) => void; codexEffort?: string; onCodexEffort?: (effort: string) => void; codexPermission?: CodexPermissionLevel; onCodexPermission?: (level: CodexPermissionLevel) => void; disabled?: boolean
}
export function CodexEngineControl({ engine = 'chatgpt', onEngine, projectPath, codexModel = '', onCodexModel, codexEffort = '', onCodexEffort, codexPermission = 'full', onCodexPermission, disabled }: EngineControlProps) {
  const { data } = useCodexStatus(projectPath, engine === 'codex')
  const model = data?.models.find((item) => codexModel ? item.model === codexModel : item.isDefault)
  const efforts = model?.supportedReasoningEfforts || []
  return <>
    <button type="button" role="switch" aria-label="Engine Codex" aria-checked={engine === 'codex'}
      disabled={disabled || !onEngine || !desktopBridge()?.codex}
      title={engine === 'codex' ? 'Codex Native · acesso direto ao computador · mudar para ChatGPT Scraper' : 'ChatGPT Scraper ativo · mudar para Codex Native com acesso ao computador'}
      onClick={() => onEngine?.(engine === 'codex' ? 'chatgpt' : 'codex')}
      className="inline-flex !h-8 !min-h-8 shrink-0 items-center gap-1.5 !rounded-[var(--radius-popover)] !border !border-solid !border-whx-border-soft ![box-shadow:none] !bg-whx-muted !px-2 !py-0 !text-[calc(10.5px*var(--ui-font-scale))] !font-semibold !text-whx-soft hover:!border-whx-accent disabled:!opacity-40">
      <Icon name={engine === 'codex' ? 'code' : 'chatgpt'} size={13}/>
      {engine === 'codex' ? 'Codex' : 'ChatGPT Scraper'}
      <span aria-hidden="true" className={`relative ml-1 h-3 w-5 rounded-full ${engine === 'codex' ? 'bg-whx-accent' : 'bg-whx-border'}`}><span className={`absolute top-0.5 size-2 rounded-full bg-whx-text transition-transform ${engine === 'codex' ? 'translate-x-2.5' : 'translate-x-0.5'}`}/></span>
    </button>
    {engine === 'codex' && <ComposerSelectChoice label="Permissões Codex" title="Pedir aprovação para acesso externo e internet; Aprovar por mim usa revisão automática do Codex; Acesso total permite alterações no computador" icon={<Icon name="shield" size={12}/>}
      value={codexPermission} onChange={onCodexPermission} disabled={disabled}
      options={[{ value: 'ask', label: 'Pedir aprovação' }, { value: 'auto', label: 'Aprovar por mim' }, { value: 'full', label: 'Acesso total' }]}/>}
    {engine === 'codex' && <ComposerSelectChoice label="Modelo Codex" title="Modelos disponibilizados pelo runtime Codex" icon={<Icon name="sparkles" size={12}/>}
      value={codexModel} onChange={onCodexModel} disabled={disabled}
      options={[{ value: '', label: 'Padrão do Codex' }, ...(codexModel && !data?.models.some((item) => item.model === codexModel) ? [{ value: codexModel, label: `${codexModel} · guardado` }] : []), ...(data?.models || []).map((model) => ({ value: model.model, label: model.label || model.model }))]}/>}
    {engine === 'codex' && <ComposerSelectChoice label="Esforço Codex" title="Esforços disponibilizados pelo modelo Codex selecionado" icon={<Icon name="activity" size={12}/>}
      value={codexEffort} onChange={onCodexEffort} disabled={disabled}
      options={[{ value: '', label: `Esforço · ${model?.defaultReasoningEffort || 'padrão'}` }, ...(codexEffort && !efforts.some((item) => item.reasoningEffort === codexEffort) ? [{ value: codexEffort, label: `${codexEffort} · guardado` }] : []), ...efforts.map((item) => ({ value: item.reasoningEffort, label: item.reasoningEffort }))]}/>}
  </>
}
