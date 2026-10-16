import { DataSettings } from './data'
import { WorkspaceSettings, BundleLimitsSettings, ComposerSettings } from './environment'
import { ContextSettings } from './context'
import { useEffect, useState } from 'react'
import { api } from '../../../lib/transport/http/api'
import { bytesToMiB, formatPatternLines, miBToBytes, parsePatternLines } from '../../../lib/project/context/projectConfig'
import type { AppConfig, ArtifactSettings, BackendStorageUsage, ContextInspection, ContextMode, ProjectConfig, Session, TunnelProviderDocument } from '../../../types'
import { ContextInspector, type ContextSelection } from '../../editor/inspector/ContextInspector'
import { ContextSettingsState } from './presentation'
import { InternalWindow } from '../../workspace/window/InternalWindow'
import { desktopBridge, formatBytes } from '../../../lib/desktop/bridge/desktop'
import { loadUIPreferences, saveUIPreferences, subscribeUIPreferences, type UIPreferences } from '../../../lib/workspace/preferences/uiPreferences'
import { confirmDialog, noticeDialog } from '../../../lib/desktop/bridge/appDialog'
import { RemoteStorageSettings } from './RemoteStorageSettings'
import { TunnelProviderSettings } from './TunnelProviderSettings'
import { LanguageSettingsPanel } from './LanguageSettingsPanel'
import { loadWorkspaceDirectory, saveWorkspaceDirectory } from '../../../lib/chat/history/workspaceMemory'

import { SettingsFrame, type SettingsSection } from './navigation'
import { AppearanceSettings } from './appearance'

export function ProjectSettings({ session, onClose, onSession, onError, onTunnelConfigSaved }: {
  session?: Session
  onClose: () => void
  onSession?: (session: Session) => void
  onError: (message: string) => void
  onTunnelConfigSaved?: (config: TunnelProviderDocument, runtime?: AppConfig) => void
}) {
  const [config, setConfig] = useState<ProjectConfig>()
  const [savedAutoExclude, setSavedAutoExclude] = useState(true)
  const [inspection, setInspection] = useState<ContextInspection>()
  const [include, setInclude] = useState('')
  const [exclude, setExclude] = useState('')
  const [maxMiB, setMaxMiB] = useState(2)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [configuring, setConfiguring] = useState(false)
  const [loadingError, setLoadingError] = useState('')
  const [inspectionError, setInspectionError] = useState('')
  const [reloadNonce, setReloadNonce] = useState(0)
  const [backendStorage, setBackendStorage] = useState<BackendStorageUsage>()
  const [desktopStorage, setDesktopStorage] = useState<DesktopStorageUsage>()
  const [storageBusy, setStorageBusy] = useState(false)
  const [resetConfirm, setResetConfirm] = useState('')
  const [artifactRetentionDays, setArtifactRetentionDays] = useState(30)
  const [bundleWindowLimit, setBundleWindowLimit] = useState(80)
  const [attachmentCountLimit, setAttachmentCountLimit] = useState(0)
  const [requestBundleTotalMiB, setRequestBundleTotalMiB] = useState(100)
  const [requestBundlePartMiB, setRequestBundlePartMiB] = useState(30)
  const [requestBundlePartLimit, setRequestBundlePartLimit] = useState(10)
  const [uiPreferences, setUIPreferences] = useState<UIPreferences>(() => loadUIPreferences())
  const [activeSection, setActiveSection] = useState<SettingsSection>('appearance')
  const [workspaceDirectory, setWorkspaceDirectory] = useState(() => loadWorkspaceDirectory())

  useEffect(() => subscribeUIPreferences(setUIPreferences), [])

  useEffect(() => {
    let alive = true
    setConfig(undefined); setInspection(undefined); setLoadingError(''); setInspectionError('')
    if (session) {
      api.projectConfig(session.id).then((value) => {
        if (!alive) return
        setConfig(value); setSavedAutoExclude(value.context.auto_exclude)
        setInclude(formatPatternLines(value.context.include || []))
        setExclude(formatPatternLines(value.context.exclude || []))
        setMaxMiB(bytesToMiB(value.context.max_file_bytes))
      }).catch((error) => {
        if (!alive) return
        const message = messageOf(error, 'Não foi possível carregar whaness.yml')
        setLoadingError(message); onError(message)
      })
      api.contextInspection(session.id).then((value) => { if (alive) setInspection(value) }).catch((error) => {
        if (!alive) return
        setInspectionError(messageOf(error, 'Não foi possível inspecionar o contexto'))
      })
    }
    api.storage().then((value) => { if (alive) setBackendStorage(value) }).catch(() => {})
    api.artifactSettings().then((value) => { if (alive) { applyArtifactSettings(value) } }).catch(() => {})
    const bridge = desktopBridge()
    if (bridge) bridge.data.storage().then((value) => { if (alive) setDesktopStorage(value) }).catch(() => {})
    return () => { alive = false }
  }, [session?.id, onError, reloadNonce])

  function applyArtifactSettings(value: ArtifactSettings) {
    setArtifactRetentionDays(value.retention_days)
    setBundleWindowLimit(value.bundle_window_limit)
    setAttachmentCountLimit(value.attachment_count_limit || 0)
    setRequestBundleTotalMiB(Math.max(1, Math.round((value.request_bundle_total_bytes || 100 * 1024 * 1024) / (1024 * 1024))))
    setRequestBundlePartMiB(Math.max(1, Math.round((value.request_bundle_part_bytes || 30 * 1024 * 1024) / (1024 * 1024))))
    setRequestBundlePartLimit(value.request_bundle_part_limit || 10)
  }

  async function saveArtifactSettings(failureMessage: string) {
    if (storageBusy) return
    setStorageBusy(true)
    try {
      const value = await api.updateArtifactSettings({
        retention_days: artifactRetentionDays,
        bundle_window_limit: bundleWindowLimit,
        attachment_count_limit: attachmentCountLimit,
        request_bundle_total_bytes: Math.round(requestBundleTotalMiB * 1024 * 1024),
        request_bundle_part_bytes: Math.round(requestBundlePartMiB * 1024 * 1024),
        request_bundle_part_limit: requestBundlePartLimit,
      })
      applyArtifactSettings(value)
    } catch (error) { onError(messageOf(error, failureMessage)) }
    finally { setStorageBusy(false) }
  }

  async function save() {
    if (!session || !config || saving) return
    setSaving(true)
    try {
      const next: ProjectConfig = { ...config, context: { ...config.context, max_file_bytes: miBToBytes(maxMiB), include: parsePatternLines(include), include_overrides: config.context.include_overrides || [], exclude: parsePatternLines(exclude) } }
      const result = await api.updateProjectConfig(session.id, next)
      setConfig(result.config); setSavedAutoExclude(result.config.context.auto_exclude); onSession?.(result.session)
      const nextInspection = await api.contextInspection(session.id)
      setInspection(nextInspection)
    } catch (error) { onError(messageOf(error, 'Não foi possível guardar a configuração do projeto')) }
    finally { setSaving(false) }
  }

  async function changeContextMode(mode: ContextMode) {
    if (!session || saving) return
    setSaving(true)
    try { onSession?.(await api.setContextMode(session.id, mode)) }
    catch (error) { onError(messageOf(error, 'Não foi possível alterar a modalidade de contexto')) }
    finally { setSaving(false) }
  }

  async function applyContextSelection(selection: ContextSelection) {
    if (!session || !config || configuring) return
    if (selection.action === 'include' && selection.kind === 'directory' && !(await confirmDialog({
      title: 'Incluir pasta no contexto?',
      message: `${selection.path} e os seus ficheiros elegíveis passarão a ocupar o contexto. Pastas de SDK/cache podem ser muito grandes; confirme apenas se este conteúdo for realmente útil ao planner.`,
      tone: 'warning',
      confirmLabel: 'Incluir pasta',
    }))) return
    const pattern = selection.kind === 'directory' ? `${selection.path.replace(/\/$/, '')}/**` : selection.path
    const overrides = config.context.include_overrides || []
    const nextOverrides = selection.action === 'include'
      ? uniquePatterns([...overrides, pattern])
      : overrides.filter((value) => !patternContains(pattern, value) && !patternContains(value, pattern))
    const nextExcludes = selection.action === 'exclude'
      ? uniquePatterns([...config.context.exclude, pattern])
      : config.context.exclude
    const next: ProjectConfig = { ...config, context: { ...config.context, include_overrides: nextOverrides, exclude: nextExcludes } }
    setConfiguring(true)
    try {
      const result = await api.updateProjectConfig(session.id, next)
      setConfig(result.config); setSavedAutoExclude(result.config.context.auto_exclude)
      setInclude(formatPatternLines(result.config.context.include || []))
      setExclude(formatPatternLines(result.config.context.exclude || []))
      onSession?.(result.session)
      setInspection(await api.contextInspection(session.id))
    } catch (error) { onError(messageOf(error, `Não foi possível ${selection.action === 'include' ? 'incluir' : 'excluir'} ${selection.path}`)) }
    finally { setConfiguring(false) }
  }

  async function refresh() {
    if (!session || refreshing) return
    setRefreshing(true); setInspectionError('')
    try {
      const nextSession = await api.refreshContext(session.id)
      onSession?.(nextSession)
      setInspection(await api.contextInspection(session.id))
    } catch (error) {
      const message = messageOf(error, 'Não foi possível reconstruir o contexto')
      setInspectionError(message); onError(message)
    } finally { setRefreshing(false) }
  }

  async function browseWorkspace() {
    const bridge = desktopBridge()
    if (!bridge?.projects) return
    try {
      const picked = await bridge.projects.pickDirectory({ title: 'Selecionar workspace padrão', defaultPath: workspaceDirectory || undefined })
      if (picked.cancelled || !picked.path) return
      saveWorkspaceDirectory(picked.path)
      setWorkspaceDirectory(picked.path)
    } catch (error) { onError(messageOf(error, 'Não foi possível selecionar o workspace')) }
  }

  function persistWorkspace() {
    saveWorkspaceDirectory(workspaceDirectory)
    setWorkspaceDirectory(loadWorkspaceDirectory())
  }

  function clearWorkspace() {
    saveWorkspaceDirectory('')
    setWorkspaceDirectory('')
  }

  async function refreshStorage() {
    setStorageBusy(true)
    try {
      setBackendStorage(await api.storage())
      const bridge = desktopBridge()
      if (bridge) setDesktopStorage(await bridge.data.storage())
    } catch (error) { onError(messageOf(error, 'Não foi possível atualizar as métricas de armazenamento')) }
    finally { setStorageBusy(false) }
  }

  async function exportBrowserSession() {
    const bridge = desktopBridge()
    if (!bridge) return onError('Exportação da sessão do navegador requer Wharnex Desktop.')
    setStorageBusy(true)
    try {
      const result = await bridge.data.exportBrowserSession()
      if (!result.cancelled) await noticeDialog({
        title: 'Sessão exportada',
        message: `${result.filename || 'ficheiro .whbs'} (${formatBytes(result.bytes || 0)}) foi exportado. Guarde este ficheiro como um segredo.`,
        tone: 'success',
        confirmLabel: 'Concluir',
      })
      await refreshStorage()
    } catch (error) { onError(messageOf(error, 'Falha ao exportar a sessão do navegador')) }
    finally { setStorageBusy(false) }
  }

  async function importBrowserSession() {
    const bridge = desktopBridge()
    if (!bridge) return onError('Importação da sessão do navegador requer Wharnex Desktop.')
    if (!(await confirmDialog({
      title: 'Importar sessão do navegador?',
      message: 'A sessão atual do navegador interno será substituída e o Wharnex será reiniciado para ativar a sessão importada.',
      tone: 'warning',
      confirmLabel: 'Importar e reiniciar',
    }))) return
    setStorageBusy(true)
    try { await bridge.data.importBrowserSession() }
    catch (error) { setStorageBusy(false); onError(messageOf(error, 'Falha ao importar a sessão do navegador')) }
  }

  async function clearBrowserSession() {
    const bridge = desktopBridge()
    if (!bridge) return onError('Limpeza da sessão do navegador requer Wharnex Desktop.')
    if (!(await confirmDialog({
      title: 'Limpar sessão do navegador?',
      message: 'Cookies, cache e armazenamento da sessão do navegador interno serão removidos. Será necessário autenticar novamente no ChatGPT.',
      tone: 'danger',
      confirmLabel: 'Limpar sessão',
    }))) return
    setStorageBusy(true)
    try {
      await bridge.data.clearBrowserSession()
      await refreshStorage()
      await noticeDialog({ title: 'Sessão limpa', message: 'Os dados da sessão do navegador interno foram removidos.', tone: 'success' })
    }
    catch (error) { onError(messageOf(error, 'Falha ao limpar a sessão do navegador')) }
    finally { setStorageBusy(false) }
  }

  async function clearAllWharnexData() {
    if (resetConfirm.trim() !== 'APAGAR WHARNEX') return
    const bridge = desktopBridge()
    if (!bridge) return onError('Limpeza completa requer Wharnex Desktop.')
    setStorageBusy(true)
    try {
      await api.clearStorage(resetConfirm.trim())
      await bridge.data.clearAll(resetConfirm.trim())
      localStorage.clear()
      window.location.reload()
    } catch (error) { onError(messageOf(error, 'Falha ao limpar todos os dados do Wharnex')); setStorageBusy(false) }
  }

  const contextDirty = Boolean(config && (config.context.auto_exclude !== savedAutoExclude || JSON.stringify(parsePatternLines(include)) !== JSON.stringify(config.context.include || []) || JSON.stringify(parsePatternLines(exclude)) !== JSON.stringify(config.context.exclude || []) || miBToBytes(maxMiB) !== config.context.max_file_bytes))
  const closeSettings = async () => {
    if (contextDirty && !(await confirmDialog({ title: 'Descartar alterações nas definições?', message: 'O contexto tem alterações por guardar. Fechar agora descarta apenas este rascunho.', tone: 'warning', confirmLabel: 'Descartar e fechar' }))) return
    onClose()
  }
  return <InternalWindow title="Configurações" layerClassName="project-settings-backdrop" onClose={() => void closeSettings()} maximizable controlsInHeader closeLabel="Fechar configurações">
    <SettingsFrame projectPath={session?.project_path} section={activeSection} onSection={setActiveSection} onClose={() => void closeSettings()} dirty={contextDirty} saving={saving} onSave={config ? () => void save() : undefined}>
        {activeSection === 'language' ? <LanguageSettingsPanel onError={onError}/> : null}
        {activeSection === 'composer' && <ComposerSettings threshold={uiPreferences.largePasteThresholdChars} onChange={(value) => setUIPreferences(saveUIPreferences({ ...uiPreferences, largePasteThresholdChars: value }))}/>}
        {activeSection === 'appearance' && <AppearanceSettings preferences={uiPreferences} onChange={(value) => setUIPreferences(saveUIPreferences({ ...uiPreferences, ...value }))}/>}
        {activeSection === 'context' ? (!config ? <ContextSettingsState error={loadingError} onRetry={() => setReloadNonce((value) => value + 1)}/> : <><ContextSettings config={config} session={session} include={include} exclude={exclude} maxMiB={maxMiB} saving={saving} onConfig={setConfig} onInclude={setInclude} onExclude={setExclude} onMaxMiB={setMaxMiB} onMode={(mode) => void changeContextMode(mode)}/>

        <section className="context-explorer-section">
          {inspection ? <ContextInspector inspection={inspection} refreshing={refreshing} configuring={configuring} onRefresh={() => void refresh()} onSelection={(selection) => void applyContextSelection(selection)} /> : <ContextSettingsState error={inspectionError} snapshot onRetry={() => setReloadNonce((value) => value + 1)}/>}
        </section></>) : null}
        {activeSection === 'workspace' && <WorkspaceSettings directory={workspaceDirectory} onDirectory={setWorkspaceDirectory} canBrowse={Boolean(desktopBridge()?.projects)} onBrowse={() => void browseWorkspace()} onSave={persistWorkspace} onClear={clearWorkspace}/>}
        {activeSection === 'tunnel-provider' ? <TunnelProviderSettings onError={onError} onSaved={onTunnelConfigSaved}/> : null}
        {activeSection === 'remote-storage' ? <RemoteStorageSettings onError={onError}/> : null}
        {activeSection === 'limits' && <BundleLimitsSettings value={{ attachments: attachmentCountLimit, totalMiB: requestBundleTotalMiB, partMiB: requestBundlePartMiB, parts: requestBundlePartLimit }} onChange={(value) => { if (value.attachments !== undefined) setAttachmentCountLimit(value.attachments); if (value.totalMiB !== undefined) setRequestBundleTotalMiB(value.totalMiB); if (value.partMiB !== undefined) setRequestBundlePartMiB(value.partMiB); if (value.parts !== undefined) setRequestBundlePartLimit(value.parts) }} busy={storageBusy} onSave={() => void saveArtifactSettings('Falha ao guardar limites')}/>}
        {activeSection === 'data' && <DataSettings backend={backendStorage} desktop={desktopStorage} projectPath={session?.project_path} busy={storageBusy} canManageBrowser={Boolean(desktopBridge())} retentionDays={artifactRetentionDays} bundleLimit={bundleWindowLimit} confirmation={resetConfirm} onRetention={setArtifactRetentionDays} onBundleLimit={setBundleWindowLimit} onConfirmation={setResetConfirm} onSaveRetention={() => void saveArtifactSettings('Falha ao guardar retenção')} onSaveQuota={() => void saveArtifactSettings('Falha ao guardar quota de bundles')} onRefresh={() => void refreshStorage()} onExport={() => void exportBrowserSession()} onImport={() => void importBrowserSession()} onClearSession={() => void clearBrowserSession()} onReset={() => void clearAllWharnexData()}/>}
    </SettingsFrame>
  </InternalWindow>
}

function messageOf(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback }
function uniquePatterns(values: string[]) { return Array.from(new Set(values)) }
function patternContains(parent: string, candidate: string) { const prefix = parent.endsWith('/**') ? parent.slice(0, -3) : ''; return candidate === parent || Boolean(prefix && (candidate === prefix || candidate.startsWith(`${prefix}/`))) }
