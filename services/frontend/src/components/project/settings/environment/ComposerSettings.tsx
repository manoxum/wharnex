import { Field, Input } from '../../../presentation/workbench'
import { SettingsPage } from '../presentation'

export function ComposerSettings({ threshold, onChange }: { threshold: number; onChange: (value: number) => void }) {
  return <SettingsPage title="Pastes e anexos" description="Controle quando textos colados viram anexos legíveis por @see e mantenha o composer leve.">
    <Field label="Texto colado muito grande" description="Acima do limite, o texto é anexado como Pasted Text em vez de ocupar o editor."><div className="flex flex-wrap items-center gap-3"><Input aria-label="Tamanho mínimo para transformar paste em anexo" type="number" min={1000} max={200000} step={500} value={threshold} className="!w-36" onChange={(event) => onChange(Number(event.target.value))}/><span className="text-whx-caption text-whx-faint">caracteres</span></div></Field>
    <p className="!m-0 !text-whx-caption !leading-relaxed !text-whx-faint">Pastes menores continuam no editor. O padrão é 6 000 caracteres.</p>
  </SettingsPage>
}
