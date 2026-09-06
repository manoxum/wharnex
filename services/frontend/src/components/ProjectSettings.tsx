import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { bytesToMiB, formatPatternLines, miBToBytes, parsePatternLines } from '../lib/projectConfig'
import type { BackendStorageUsage, ContextInspection, ProjectConfig, Session } from '../types'
import { ContextInspector } from './ContextInspector'
import { Icon } from './Icon'
import { desktopBridge, formatBytes } from '../lib/desktop'
import { loadUIPreferences, saveUIPreferences, subscribeUIPreferences, type UIPreferences } from '../lib/uiPreferences'
import { confirmDialog, noticeDialog } from '../lib/appDialog'
import { ThemePreferenceControl } from './ThemeToggle'
import { RemoteStorageSettings } from './RemoteStorageSettings'
import { TunnelProviderSettings } from './TunnelProviderSettings'

type SettingsSection = 'appearance' | 'context' | 'tunnel-provider' | 'remote-storage' | 'data'

export function ProjectSettings({ session, onClose, onSession, onError }: {
  session: Session
  onClose: () => void
  onSession: (session: Session) => void
  onError: (message: string) => void
}) {
  const [config, setConfig] = useState<ProjectConfig>()
  const [inspection, setInspection] = useState<ContextInspection>()
  const [include, setInclude] = useState('')
  const [exclude, setExclude] = useState('')
  const [maxMiB, setMaxMiB] = useState(2)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingError, setLoadingError] = useState('')
  const [inspectionError, setInspectionError] = useState('')
  const [reloadNonce, setReloadNonce] = useState(0)
  const [backendStorage, setBackendStorage] = useState<BackendStorageUsage>()
  const [desktopStorage, setDesktopStorage] = useState<DesktopStorageUsage>()
  const [storageBusy, setStorageBusy] = useState(false)
  const [resetConfirm, setResetConfirm] = useState('')
  const [artifactRetentionDays, setArtifactRetentionDays] = useState(30)
  const [uiPreferences, setUIPreferences] = useState<UIPreferences>(() => loadUIPreferences())
  const [activeSection, setActiveSection] = useState<SettingsSection>('context')

  useEffect(() => subscribeUIPreferences(setUIPreferences), [])

  useEffect(() => {
    let alive = true
    setConfig(undefined); setInspection(undefined); setLoadingError(''); setInspectionError('')
    api.projectConfig(session.id).then((value) => {
      if (!alive) return
      setConfig(value)
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
    api.storage().then((value) => { if (alive) setBackendStorage(value) }).catch(() => {})
    api.artifactSettings().then((value) => { if (alive) setArtifactRetentionDays(value.retention_days) }).catch(() => {})
    const bridge = desktopBridge()
    if (bridge) bridge.data.storage().then((value) => { if (alive) setDesktopStorage(value) }).catch(() => {})
    return () => { alive = false }
  }, [session.id, onError, reloadNonce])

  async function save() {
    if (!config || saving) return
    setSaving(true)
    try {
      const next: ProjectConfig = { ...config, context: { ...config.context, max_file_bytes: miBToBytes(maxMiB), include: parsePatternLines(include), exclude: parsePatternLines(exclude) } }
      const result = await api.updateProjectConfig(session.id, next)
      setConfig(result.config); onSession(result.session)
      const nextInspection = await api.contextInspection(session.id)
      setInspection(nextInspection)
    } catch (error) { onError(messageOf(error, 'Não foi possível guardar a configuração do projeto')) }
    finally { setSaving(false) }
  }

  async function refresh() {
    if (refreshing) return
    setRefreshing(true); setInspectionError('')
    try {
      const nextSession = await api.refreshContext(session.id)
      onSession(nextSession)
      setInspection(await api.contextInspection(session.id))
    } catch (error) {
      const message = messageOf(error, 'Não foi possível reconstruir o contexto')
      setInspectionError(message); onError(message)
    } finally { setRefreshing(false) }
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
    if (!bridge) return onError('Exportação da sessão do navegador requer Wharness Desktop.')
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
    if (!bridge) return onError('Importação da sessão do navegador requer Wharness Desktop.')
    if (!(await confirmDialog({
      title: 'Importar sessão do navegador?',
      message: 'A sessão atual do navegador interno será substituída e o Wharness será reiniciado para ativar a sessão importada.',
      tone: 'warning',
      confirmLabel: 'Importar e reiniciar',
    }))) return
    setStorageBusy(true)
    try { await bridge.data.importBrowserSession() }
    catch (error) { setStorageBusy(false); onError(messageOf(error, 'Falha ao importar a sessão do navegador')) }
  }

  async function clearBrowserSession() {
    const bridge = desktopBridge()
    if (!bridge) return onError('Limpeza da sessão do navegador requer Wharness Desktop.')
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

  async function clearAllWharnessData() {
    if (resetConfirm.trim() !== 'APAGAR WHARNESS') return
    const bridge = desktopBridge()
    if (!bridge) return onError('Limpeza completa requer Wharness Desktop.')
    setStorageBusy(true)
    try {
      await api.clearStorage(resetConfirm.trim())
      await bridge.data.clearAll(resetConfirm.trim())
      localStorage.clear()
      window.location.reload()
    } catch (error) { onError(messageOf(error, 'Falha ao limpar todos os dados do Wharness')); setStorageBusy(false) }
  }

  return <div className="project-settings-backdrop" data-chatgpt-overlay-blocker="true" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
    <section className="project-settings-dialog context-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="project-settings-title">
      <header>
        <div><span className="eyebrow">Wharness</span><h2 id="project-settings-title">Configurações</h2><p>Preferências do projeto, transporte de contexto e dados locais num só lugar.</p></div>
        <button className="icon-button" onClick={onClose} title="Fechar"><Icon name="close" size={16}/></button>
      </header>
      <div className="project-settings-body settings-layout">
        <nav className="settings-navigation" aria-label="Secções das configurações">
          <SettingsNavButton active={activeSection === 'appearance'} icon="monitor" label="Aparência" detail="Tema e tipografia" onClick={() => setActiveSection('appearance')}/>
          <SettingsNavButton active={activeSection === 'context'} icon="file" label="Contexto" detail="Recorte do projeto" onClick={() => setActiveSection('context')}/>
          <SettingsNavButton active={activeSection === 'tunnel-provider'} icon="network" label="Tunnel Provider" detail="Transporte ChatGPT" onClick={() => setActiveSection('tunnel-provider')}/>
          <SettingsNavButton active={activeSection === 'remote-storage'} icon="network" label="Storage remoto" detail="Contas e limites" onClick={() => setActiveSection('remote-storage')}/>
          <SettingsNavButton active={activeSection === 'data'} icon="shield" label="Dados locais" detail="Uso e limpeza" onClick={() => setActiveSection('data')}/>
        </nav>
        <main className="settings-content">
        {activeSection === 'appearance' ? <section className="appearance-settings-section">
          <div className="context-section-title"><div><strong>Aparência e tipografia</strong><span>Ajuste a leitura da interface sem alterar o projeto. As preferências são locais ao Wharness.</span></div><code>{Math.round(uiPreferences.scale * 100)}%</code></div>
          <ThemePreferenceControl value={uiPreferences.theme} onChange={(theme) => { const next = saveUIPreferences({ ...uiPreferences, theme }); setUIPreferences(next) }} />
          <div className="typography-settings-grid">
            <label><span>Fonte da interface</span><select value={uiPreferences.uiFont} onChange={(event) => { const next = saveUIPreferences({ ...uiPreferences, uiFont: event.target.value as UIPreferences['uiFont'] }); setUIPreferences(next) }}><option value="elegant">Elegante · Inter / Manrope</option><option value="system">Sistema · Segoe / nativa</option><option value="humanist">Humanista · Aptos / Calibri</option></select></label>
            <label><span>Fonte monoespaçada</span><select value={uiPreferences.monoFont} onChange={(event) => { const next = saveUIPreferences({ ...uiPreferences, monoFont: event.target.value as UIPreferences['monoFont'] }); setUIPreferences(next) }}><option value="jetbrains">JetBrains Mono</option><option value="system">Sistema Mono</option><option value="fira">Fira Code</option></select></label>
          </div>
          <label className="font-scale-setting"><span><strong>Tamanho da interface</strong><small>100% é o centro da escala e usa uma base maior; reduza até 40% ou amplie até 160%.</small></span><input type="range" min="0.4" max="1.6" step="0.05" value={uiPreferences.scale} onChange={(event) => { const next = saveUIPreferences({ ...uiPreferences, scale: Number(event.target.value) }); setUIPreferences(next) }}/><output>{Math.round(uiPreferences.scale * 100)}%</output></label>
          <label className="settings-toggle"><input type="checkbox" checked={uiPreferences.errorPopups} onChange={(event) => { const next = saveUIPreferences({ ...uiPreferences, errorPopups: event.target.checked }); setUIPreferences(next) }}/><span><strong>Popups de erro</strong><small>Mostra apenas um aviso compacto e não bloqueante. Os detalhes completos continuam no chat e o aviso pode ser desativado.</small></span></label>
        </section> : null}
        {activeSection === 'context' ? (!config ? (loadingError
          ? <div className="settings-load-error"><Icon name="shield" size={22}/><div><strong>Não foi possível carregar a configuração</strong><p>{loadingError}</p><span>O backend tenta recriar automaticamente <code>whaness.yml</code> quando ele não existe. Pode tentar novamente sem fechar o projeto.</span><button className="secondary-button" onClick={() => setReloadNonce((value) => value + 1)}><Icon name="refresh" size={14}/> Tentar novamente</button></div></div>
          : <div className="settings-loading"><span className="settings-spinner"/>A carregar configuração…</div>) : <><section className="context-config-section">
          <div className="context-section-title"><div><strong>Configuração fina</strong><span>Estas opções alteram a próxima reconstrução do contexto.</span></div><code>{session.context.manifest.sha256.slice(0, 12)}</code></div>
          <label className="settings-toggle"><input type="checkbox" checked={config.context.auto_exclude} onChange={(event) => setConfig({ ...config, context: { ...config.context, auto_exclude: event.target.checked } })}/><span><strong>Reconhecimento automático</strong><small>Exclui dependências, caches, builds, binários, logs, IDE metadata e outros artefactos sem valor para a IA.</small></span></label>
          <div className="settings-grid">
            <label><span>Incluir apenas <small>opcional</small></span><textarea value={include} onChange={(event) => setInclude(event.target.value)} placeholder={'src/**\ndocs/**\ngo.mod'}/><small>Se vazio, todos os ficheiros elegíveis são considerados.</small></label>
            <label><span>Excluir do contexto</span><textarea value={exclude} onChange={(event) => setExclude(event.target.value)} placeholder={'fixtures/**\n*.generated.ts\nlegacy/**'}/><small>Um padrão por linha. Suporta <code>*</code>, <code>?</code> e <code>**</code>.</small></label>
          </div>
          <label className="settings-size"><span>Tamanho máximo por ficheiro</span><div><input type="number" min={1} max={64} value={maxMiB} onChange={(event) => setMaxMiB(Number(event.target.value) || 1)}/><span>MiB</span></div><small>Ficheiros maiores são registados como excluídos no manifesto.</small></label>
          <div className="settings-security-note"><Icon name="shield" size={16}/><span>Segredos, chaves privadas, VCS interno, symlinks e outros caminhos protegidos continuam bloqueados mesmo com configuração permissiva.</span></div>
          <div className="context-config-actions"><button className="primary-button" disabled={saving} onClick={() => void save()}><Icon name="save" size={15}/>{saving ? 'A guardar…' : 'Guardar e reconstruir contexto'}</button></div>
        </section>
        <section className="context-explorer-section">
          {inspection ? <ContextInspector inspection={inspection} refreshing={refreshing} onRefresh={() => void refresh()} /> : inspectionError ? <div className="context-inspection-error"><Icon name="shield" size={16}/><span>{inspectionError}</span><button onClick={() => setReloadNonce((value) => value + 1)}>Tentar novamente</button></div> : <div className="settings-loading compact"><span className="settings-spinner"/>A inspecionar o snapshot final…</div>}
        </section></>) : null}
        {activeSection === 'tunnel-provider' ? <TunnelProviderSettings onError={onError}/> : null}
        {activeSection === 'remote-storage' ? <RemoteStorageSettings onError={onError}/> : null}
        {activeSection === 'data' ? <section className="wharness-data-section">
          <div className="context-section-title"><div><strong>Dados e armazenamento</strong><span>Sessão do navegador, métricas de disco e operações de limpeza do Wharness.</span></div><button className="icon-button" disabled={storageBusy} onClick={() => void refreshStorage()} title="Atualizar métricas"><Icon name="refresh" size={15}/></button></div>
          <div className="storage-metrics">
            <StorageMetric label="Wharness total" bytes={(backendStorage?.total_bytes || 0) + (desktopStorage?.total_bytes || 0)} />
            <StorageMetric label="Navegador interno" bytes={desktopStorage?.browser_bytes || 0} />
            <StorageMetric label="Anexos de chats" bytes={desktopStorage?.attachment_bytes || 0} />
            <StorageMetric label="Artefactos MinIO" bytes={backendStorage?.artifact_bytes || 0} />
            <StorageMetric label="Contextos/sandboxes" bytes={(backendStorage?.context_bytes || 0) + (backendStorage?.sandbox_bytes || 0)} />
            <StorageMetric label="Temporários/órfãos" bytes={(backendStorage?.orphan_bytes || 0) + (desktopStorage?.temp_bytes || 0)} />
          </div>
          <div className="project-storage-list">
            {(backendStorage?.projects || []).map((project) => <div key={project.project_path} className={project.project_path === session.project_path ? 'project-storage-row active' : 'project-storage-row'}><div><strong>{project.project_path === session.project_path ? 'Projeto atual' : project.project_path.split('/').filter(Boolean).pop()}</strong><span title={project.project_path}>{project.project_path}</span></div><code>{formatBytes(project.total_bytes)}</code></div>)}
            {!backendStorage?.projects?.length && <span className="muted-copy">Sem métricas de projeto disponíveis.</span>}
          </div>
          <div className="browser-session-actions">
            <div><strong>Retenção de artefactos no MinIO</strong><span>Bundles e ficheiros trocados são removidos automaticamente depois deste período. O padrão é 30 dias.</span></div>
            <div><input type="number" min={1} max={3650} value={artifactRetentionDays} onChange={(event) => setArtifactRetentionDays(Math.max(1, Math.min(3650, Number(event.target.value) || 30)))} style={{ width: 92 }}/><span> dias </span><button className="secondary-button" disabled={storageBusy} onClick={() => void api.updateArtifactSettings(artifactRetentionDays).then((value) => setArtifactRetentionDays(value.retention_days)).catch((error) => onError(messageOf(error, 'Falha ao guardar retenção')))}>Guardar</button></div>
          </div>
          <div className="browser-session-actions">
            <div><strong>Sessão do navegador interno</strong><span>O ficheiro exportado pode conter uma sessão autenticada. Trate-o como segredo.</span></div>
            <div><button className="secondary-button" disabled={storageBusy || !desktopBridge()} onClick={() => void exportBrowserSession()}><Icon name="download" size={14}/> Exportar</button><button className="secondary-button" disabled={storageBusy || !desktopBridge()} onClick={() => void importBrowserSession()}><Icon name="apply" size={14}/> Importar</button><button className="secondary-button" disabled={storageBusy || !desktopBridge()} onClick={() => void clearBrowserSession()}><Icon name="close" size={14}/> Limpar sessão</button></div>
          </div>
          <div className="danger-zone">
            <div><strong>Limpar todos os dados do Wharness</strong><span>Remove sessões, histórico local, contextos, sandboxes, anexos, temporários e sessão do navegador. Os ficheiros dos projetos reais não são apagados.</span></div>
            <label><span>Digite <code>APAGAR WHARNESS</code></span><input value={resetConfirm} onChange={(event) => setResetConfirm(event.target.value)} placeholder="APAGAR WHARNESS" /></label>
            <button className="danger-button" disabled={storageBusy || resetConfirm.trim() !== 'APAGAR WHARNESS'} onClick={() => void clearAllWharnessData()}>Limpar tudo</button>
          </div>
        </section> : null}
        </main>
      </div>
      <footer><span>{footerHint(activeSection)}</span><button className="secondary-button" onClick={onClose}>Fechar</button></footer>
    </section>
  </div>
}

function StorageMetric({ label, bytes }: { label: string; bytes: number }) { return <div className="storage-metric"><span>{label}</span><strong>{formatBytes(bytes)}</strong></div> }

function SettingsNavButton({ active, icon, label, detail, onClick }: { active: boolean; icon: 'monitor' | 'file' | 'network' | 'shield'; label: string; detail: string; onClick: () => void }) {
  return <button className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={onClick}><Icon name={icon} size={16}/><span><strong>{label}</strong><small>{detail}</small></span></button>
}

function footerHint(section: SettingsSection) {
  if (section === 'remote-storage') return 'A configuração de storage é global e aplica-se a todos os projetos após reiniciar.'
  if (section === 'data') return 'Os ficheiros dos projetos reais não são removidos pelas operações desta secção.'
  if (section === 'appearance') return 'Preferências visuais ficam apenas neste dispositivo.'
  return 'Snapshot final = lista exata enviada ao ChatGPT/Planner.'
}

function messageOf(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback }
