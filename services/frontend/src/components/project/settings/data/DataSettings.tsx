import { translate as uiText } from '../../../../lib/workspace/localization'
import type { BackendStorageUsage } from '../../../../types'
import { formatBytes } from '../../../../lib/desktop/bridge/desktop'
import { Button, Field, IconButton, Input } from '../../../presentation/workbench'
import { SettingsGroup, SettingsPage } from '../presentation'

type DataSettingsProps = {
  backend?: BackendStorageUsage; desktop?: DesktopStorageUsage; projectPath?: string; busy: boolean; canManageBrowser: boolean
  retentionDays: number; bundleLimit: number; confirmation: string
  onRetention: (days: number) => void; onBundleLimit: (limit: number) => void; onConfirmation: (value: string) => void
  onSaveRetention: () => void; onSaveQuota: () => void; onRefresh: () => void
  onExport: () => void; onImport: () => void; onClearSession: () => void; onReset: () => void
}
export function DataSettings(props: DataSettingsProps) {
  const { backend, desktop, busy } = props
  const metrics = [
    ['Wharnex total', backend || desktop ? (backend?.total_bytes || 0) + (desktop?.total_bytes || 0) : undefined],
    ['Navegador interno', desktop?.browser_bytes], ['Anexos de chats', desktop?.attachment_bytes],
    ['Artefactos MinIO', backend?.artifact_bytes], ['Arquivos compactados', backend?.archive_bytes],
    ['Contextos/sandboxes', backend ? (backend.context_bytes || 0) + (backend.sandbox_bytes || 0) : undefined],
    ['Temporários/órfãos', backend || desktop ? (backend?.orphan_bytes || 0) + (desktop?.temp_bytes || 0) : undefined],
  ] as const
  return <SettingsPage title={uiText("Dados e armazenamento")} description={uiText("Sessão do navegador, métricas de disco e operações de limpeza do Wharnex.")}>
    <div className="flex items-center justify-between gap-3"><h4 className="!m-0 !text-whx-title !text-whx-text">{uiText("Utilização de armazenamento")}</h4><IconButton label={uiText("Atualizar métricas")} icon="refresh" disabled={busy} onClick={props.onRefresh}/></div>
    <dl className="!m-0 grid grid-cols-3 gap-x-6 gap-y-4 max-[760px]:grid-cols-2">{metrics.map(([label, bytes]) => <div key={label} className="min-w-0 border-b border-whx-border-soft pb-3"><dt className="text-whx-caption text-whx-faint">{uiText(label)}</dt><dd className="!m-0 mt-1 font-mono text-whx-title text-whx-text">{bytes === undefined ? '—' : formatBytes(bytes)}</dd></div>)}</dl>
    {!backend && !desktop && <p className="!m-0 !text-whx-caption !text-whx-faint">{uiText("As métricas ainda não estão disponíveis. Use Atualizar métricas para tentar novamente.")}</p>}
    <details className="text-whx-label text-whx-soft"><summary className="cursor-pointer py-2 focus-visible:outline-whx-accent">{uiText("Utilização por projeto")}</summary><dl className="!m-0 grid gap-2 pt-3">{(backend?.projects || []).map((project) => <div key={project.project_path} className="flex min-w-0 items-center justify-between gap-3 border-b border-whx-border-soft py-2"><dt className="min-w-0"><strong className="block truncate font-medium">{project.project_path === props.projectPath ? uiText("Projeto atual") : project.project_path.split('/').filter(Boolean).pop()}</strong><small className="block truncate font-mono text-whx-caption text-whx-faint" title={project.project_path}>{project.project_path}</small></dt><dd className="shrink-0 font-mono text-whx-label">{formatBytes(project.total_bytes)}</dd></div>)}</dl>{!backend?.projects?.length && <p className="!text-whx-caption !text-whx-faint">{uiText("Sem métricas de projeto disponíveis.")}</p>}</details>
    <SettingsGroup title={uiText("Retenção e quota")} description={uiText("Defina os limites locais de armazenamento e acompanhamento dos bundles.")}>
      <div className="browser-session-actions !grid !gap-3 !border-0 !bg-transparent !p-0">
        <Field label={uiText("Retenção de artefactos no MinIO")} description={uiText("Bundles e ficheiros trocados são removidos automaticamente depois deste período. O padrão é 30 dias.")}><div className="flex flex-wrap items-center gap-3"><Input aria-label={uiText("Dias de retenção de artefactos")} type="number" min={1} max={3650} className="!w-28" value={props.retentionDays} onChange={(event) => props.onRetention(Math.max(1, Math.min(3650, Number(event.target.value) || 30)))}/><span>{uiText("dias")}</span><Button disabled={busy} onClick={props.onSaveRetention}>{uiText("Guardar")}</Button></div></Field>
      </div>
      <div className="browser-session-actions !grid !gap-3 !border-0 !bg-transparent !p-0">
        <Field label={uiText("Quota de bundles do ChatGPT")} description={uiText("Janela móvel de 3 horas. Esta é uma estimativa local do Wharnex: mede bundles enviados e recebidos em todos os chats conhecidos pela instância; o limite configurável aplica-se aos enviados e gera apenas alerta, sem bloquear novos pedidos.")}><div className="flex flex-wrap items-center gap-3"><Input aria-label={uiText("Máximo de bundles enviados em 3 horas")} type="number" min={1} max={10000} className="!w-28" value={props.bundleLimit} onChange={(event) => props.onBundleLimit(Math.max(1, Math.min(10000, Number(event.target.value) || 80)))}/><span>{uiText("envios / 3 h")}</span><Button disabled={busy} onClick={props.onSaveQuota}>{uiText("Guardar")}</Button></div></Field>
      </div>
    </SettingsGroup>
    <SettingsGroup title={uiText("Sessão do navegador interno")} description={uiText("O ficheiro exportado pode conter uma sessão autenticada. Trate-o como segredo.")}><div className="flex flex-wrap gap-3"><Button icon="download" disabled={busy || !props.canManageBrowser} onClick={props.onExport}>{uiText("Exportar")}</Button><Button icon="apply" disabled={busy || !props.canManageBrowser} onClick={props.onImport}>{uiText("Importar")}</Button><Button tone="danger" icon="close" disabled={busy || !props.canManageBrowser} onClick={props.onClearSession}>{uiText("Limpar sessão")}</Button></div></SettingsGroup>
    <SettingsGroup title={uiText("Limpar todos os dados do Wharnex")} description={uiText("Remove sessões, histórico local, contextos, sandboxes, anexos, temporários e sessão do navegador. Os ficheiros dos projetos reais não são apagados.")}><Field label={uiText("Digite APAGAR WHARNEX")}><Input aria-label={uiText("Confirmação para limpar dados")} value={props.confirmation} onChange={(event) => props.onConfirmation(event.target.value)} placeholder="APAGAR WHARNEX"/></Field><div><Button tone="danger" disabled={busy || props.confirmation.trim() !== 'APAGAR WHARNEX'} onClick={props.onReset}>{uiText("Limpar tudo")}</Button></div></SettingsGroup>
  </SettingsPage>
}
