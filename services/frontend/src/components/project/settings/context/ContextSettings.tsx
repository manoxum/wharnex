import { translate as uiText } from '../../../../lib/workspace/localization'
import type { ContextMode, ProjectConfig, Session } from '../../../../types'
import { Field, Input, Select, StatusBadge, fieldClass } from '../../../presentation/workbench'
import { Icon } from '../../../presentation/chrome/Icon'

export function ContextSettings({ config, session, include, exclude, maxMiB, saving, onConfig, onInclude, onExclude, onMaxMiB, onMode }: {
  config: ProjectConfig; session?: Session; include: string; exclude: string; maxMiB: number; saving: boolean
  onConfig: (config: ProjectConfig) => void; onInclude: (value: string) => void; onExclude: (value: string) => void; onMaxMiB: (value: number) => void; onMode: (mode: ContextMode) => void
}) {
  return <section className="mx-auto grid max-w-[880px] gap-5 p-6 max-[760px]:p-4">
    <div><h3 className="!mb-2 !mt-0 !text-whx-heading !font-semibold !text-whx-text">{uiText("Configuração fina")}</h3><p className="!m-0 !text-whx-label !leading-relaxed !text-whx-faint">{uiText("Estas opções alteram a próxima reconstrução do contexto enviado à IA.")}</p></div>
    <div className="flex flex-wrap items-center gap-2"><StatusBadge icon="file">{config.context.include_overrides?.length || 0} {' '}{uiText("inclusões explícitas")}</StatusBadge><code className="text-whx-caption text-whx-faint">{session?.context.manifest.sha256.slice(0, 12) || '—'}</code></div>
    {session && <Field label={uiText("Modalidade de envio ao GPT")} description={uiText("Parcial envia mapas primeiro e acrescenta ficheiros por pedido. Full envia o snapshot elegível completo.")}><Select aria-label={uiText("Modalidade de contexto da sessão")} value={session.context_mode || 'full'} disabled={saving} onChange={(event) => onMode(event.target.value as ContextMode)}><option value="partial">{uiText("Parcial")}</option><option value="full">Full</option></Select></Field>}
    <label className="flex cursor-pointer items-start gap-3 text-whx-label"><input type="checkbox" className="mt-0.5 size-4 accent-whx-accent" checked={config.context.auto_exclude} onChange={(event) => onConfig({ ...config, context: { ...config.context, auto_exclude: event.target.checked } })}/><span><strong className="font-medium">{uiText("Reconhecimento automático")}</strong><small className="mt-1 block text-whx-caption leading-relaxed text-whx-faint">{uiText("Exclui dependências, caches, builds, binários, logs e metadados do IDE.")}</small></span></label>
    <details className="border-y border-whx-border-soft py-3"><summary className="cursor-pointer text-whx-label font-medium text-whx-soft">{uiText("Padrões de inclusão e exclusão")}</summary><div className="mt-4 grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">
      <Field label={uiText("Incluir apenas")} description={uiText("Opcional. Se vazio, todos os ficheiros elegíveis são considerados.")}><textarea className={`${fieldClass} !min-h-28 !w-full !resize-y !font-mono`} value={include} onChange={(event) => onInclude(event.target.value)} placeholder={'src/**\ndocs/**\ngo.mod'}/></Field>
      <Field label={uiText("Excluir do contexto")} description={uiText("Um padrão por linha. Suporta *, ? e **.")}><textarea className={`${fieldClass} !min-h-28 !w-full !resize-y !font-mono`} value={exclude} onChange={(event) => onExclude(event.target.value)} placeholder={'fixtures/**\n*.generated.ts\nlegacy/**'}/></Field>
    </div></details>
    <Field label={uiText("Tamanho máximo por ficheiro")} description={uiText("Ficheiros maiores são registados como excluídos no manifesto.")}><div className="flex items-center gap-2"><Input aria-label={uiText("Tamanho máximo por ficheiro")} type="number" min={1} max={64} value={maxMiB} onChange={(event) => onMaxMiB(Number(event.target.value) || 1)} className="!w-24"/><span className="text-whx-caption text-whx-faint">MiB</span></div></Field>
    <p className="!m-0 flex items-start gap-2 rounded-md bg-whx-muted p-3 !text-whx-caption !leading-relaxed !text-whx-faint"><span className="mt-0.5 shrink-0"><Icon name="shield" size={15}/></span>{uiText("Segredos, chaves privadas, VCS interno, symlinks e caminhos protegidos continuam bloqueados, mesmo com configuração permissiva.")}</p>
  </section>
}
