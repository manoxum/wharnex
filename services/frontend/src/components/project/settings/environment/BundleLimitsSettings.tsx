import { Button, Field, Input } from '../../../presentation/workbench'
import { SettingsGroup, SettingsPage } from '../presentation'

type Limits = { attachments: number; totalMiB: number; partMiB: number; parts: number }
export function BundleLimitsSettings({ value, onChange, busy, onSave }: { value: Limits; onChange: (value: Partial<Limits>) => void; busy: boolean; onSave: () => void }) {
  const fields = [
    { key: 'totalMiB', label: 'Tamanho total do bundle', unit: 'MiB', min: 1, max: 4095, fallback: 100, description: 'Padrão: 100 MiB. Limite do request lógico completo.' },
    { key: 'partMiB', label: 'Tamanho máximo por bundle', unit: 'MiB', min: 1, max: 256, fallback: 30, description: 'Padrão: 30 MiB. Acima disso, o request é dividido em partes remontáveis.' },
    { key: 'parts', label: 'Quantidade máxima de bundles por request', unit: 'partes', min: 1, max: 20, fallback: 10, description: 'Padrão: 10. Intervalo permitido: 1–20.' },
  ] as const
  return <SettingsPage title="Limites" description="Configura a montagem e o transporte dos request bundles enviados ao ChatGPT.">
    <SettingsGroup title="Anexos do chat" description="Zero desativa o limite de quantidade; o tamanho é governado pelo bundle completo.">
      <Field label="Número máximo de anexos por chat" description="Valor padrão: sem limite. A validação final ocorre no Desktop antes de montar o request."><div className="flex items-center gap-3"><Input aria-label="Número máximo de anexos por chat" type="number" min={0} max={65500} value={value.attachments} className="!w-28" onChange={(event) => onChange({ attachments: Math.max(0, Math.min(65500, Number(event.target.value) || 0)) })}/><span className="text-whx-caption text-whx-faint">{value.attachments === 0 ? 'sem limite' : 'ficheiros'}</span></div></Field>
    </SettingsGroup>
    <SettingsGroup title="Bundles por request" description="O Wharnex monta um bundle lógico e só o particiona quando ele ultrapassa o limite por bundle.">
      <div className="grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">{fields.map((field) => <Field key={field.key} label={field.label} description={field.description}><div className="flex items-center gap-3"><Input aria-label={field.label} type="number" min={field.min} max={field.max} value={value[field.key]} className="!w-28" onChange={(event) => onChange({ [field.key]: Math.max(field.min, Math.min(field.max, Number(event.target.value) || field.fallback)) })}/><span className="text-whx-caption text-whx-faint">{field.unit}</span></div></Field>)}</div>
      <p className="!m-0 !text-whx-caption !leading-relaxed !text-whx-faint">Se o bundle lógico couber no tamanho máximo por bundle, o Wharnex envia exatamente um ZIP. Caso contrário, envia um ZIP principal e as partes seguintes com metadados de ordem, tamanho e SHA-256 para remontagem byte a byte.</p>
    </SettingsGroup>
    <div><Button icon="save" tone="primary" disabled={busy} onClick={onSave}>{busy ? 'A guardar…' : 'Guardar limites'}</Button></div>
  </SettingsPage>
}
