import { translate as uiText, formatMessage } from '../../../../lib/workspace/localization'
import { UI_ACCENT_REGISTRY, type UIPreferences } from '../../../../lib/workspace/preferences/uiPreferences'
import { ThemePreferenceControl } from '../../../presentation/chrome/ThemeToggle'
import { Field, Select } from '../../../presentation/workbench'
import { SettingsPage, SettingsGroup } from '../presentation'

export function AppearanceSettings({ preferences, onChange }: { preferences: UIPreferences; onChange: (value: Partial<UIPreferences>) => void }) {
  const fields = [
    { key: 'contentScheme', label: uiText("Esquema do conteúdo"), options: [['follow-ui', 'Seguir interface'], ['original', 'Original'], ['dark', 'Escuro'], ['light', 'Claro'], ['high-contrast', 'Alto contraste']] },
    { key: 'density', label: uiText("Densidade"), options: [['default', 'Normal'], ['compact', 'Compacta']] },
    { key: 'toolRailPlacement', label: uiText("Barras de ferramentas"), options: [['sides', 'Laterais'], ['bottom', 'Cantos inferiores']] },
    { key: 'uiFont', label: uiText("Fonte da interface"), options: [['elegant', 'Elegante · Inter / Manrope'], ['system', 'Sistema · Segoe / nativa'], ['humanist', 'Humanista · Aptos / Calibri']] },
    { key: 'monoFont', label: uiText("Fonte monoespaçada"), options: [['jetbrains', 'JetBrains Mono'], ['system', 'Sistema Mono'], ['fira', 'Fira Code']] },
  ] as const
  return <SettingsPage title={uiText("Aparência do workbench")} description="Tema, contraste e leitura consistentes em todo o ambiente. As alterações são guardadas neste dispositivo.">
    <SettingsGroup title="Tema e identidade">
      <ThemePreferenceControl value={preferences.theme} onChange={(theme) => onChange({ theme })}/>
      <fieldset className="!m-0 !min-w-0 !border-0 !p-0"><legend className="mb-2 text-whx-label font-medium">{uiText("Cor de destaque")}</legend><div className="flex flex-wrap gap-2">{UI_ACCENT_REGISTRY.map((accent) => <button key={accent.id} type="button" aria-label={formatMessage('Destaque: {name}', { name: uiText(accent.label) })} aria-pressed={preferences.accent === accent.id} className={`!inline-flex !min-h-8 !items-center !gap-2 !rounded-md !border !border-solid !px-3 !py-1.5 !text-whx-label !shadow-none focus-visible:!outline-whx-accent ${preferences.accent === accent.id ? '!border-whx-accent !bg-whx-accent-soft !text-whx-text' : '!border-whx-border !bg-whx-surface !text-whx-faint hover:!bg-whx-hover'}`} onClick={() => onChange({ accent: accent.id })}>{uiText(accent.label)}</button>)}</div></fieldset>
    </SettingsGroup>
    <SettingsGroup title={uiText("Disposição e tipografia")}>
      <div className="grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">{fields.map((field) => <Field key={field.key} label={field.label}><Select aria-label={field.label} value={preferences[field.key]} onChange={(event) => onChange({ [field.key]: event.target.value })}>{field.options.map(([value, label]) => <option key={value} value={value}>{uiText(label)}</option>)}</Select></Field>)}</div>
      <label className="grid gap-2 text-whx-label"><span className="flex justify-between gap-3"><strong className="font-medium">{uiText("Tamanho da interface")}</strong><output>{Math.round(preferences.scale * 100)}%</output></span><input aria-label={uiText("Tamanho da interface")} type="range" min="0.4" max="1.6" step="0.05" className="!w-full accent-whx-accent" value={preferences.scale} onChange={(event) => onChange({ scale: Number(event.target.value) })}/><small className="text-whx-caption text-whx-faint">{uiText("100% é o centro da escala; reduza até 40% ou amplie até 160%.")}</small></label>
    </SettingsGroup>
    <SettingsGroup title={uiText("Feedback de erros")}>
      <label className="flex cursor-pointer items-start gap-3 text-whx-label"><input type="checkbox" className="mt-0.5 size-4 accent-whx-accent" checked={preferences.errorPopups} onChange={(event) => onChange({ errorPopups: event.target.checked })}/><span><strong className="font-medium">{uiText("Popups de erro")}</strong></span></label>
    </SettingsGroup>
  </SettingsPage>
}
