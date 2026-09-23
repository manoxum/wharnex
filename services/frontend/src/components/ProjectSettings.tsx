import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import { bytesToMiB, formatPatternLines, miBToBytes, parsePatternLines } from '../lib/projectConfig'
import type { AppConfig, ArtifactSettings, BackendStorageUsage, ContextInspection, ProjectConfig, Session, TunnelProviderDocument } from '../types'
import { ContextInspector, type ContextSelection } from './ContextInspector'
import { Icon } from './Icon'
import { InternalWindow } from './InternalWindow'
import { desktopBridge, formatBytes } from '../lib/desktop'
import { UI_ACCENT_REGISTRY, loadUIPreferences, saveUIPreferences, subscribeUIPreferences, type UIPreferences } from '../lib/uiPreferences'
import { confirmDialog, noticeDialog } from '../lib/appDialog'
import { ThemePreferenceControl } from './ThemeToggle'
import { RemoteStorageSettings } from './RemoteStorageSettings'
import { TunnelProviderSettings } from './TunnelProviderSettings'
import { LanguageSettingsPanel } from './LanguageSettingsPanel'

type SettingsSection = 'appearance' | 'composer' | 'language' | 'context' | 'tunnel-provider' | 'remote-storage' | 'limits' | 'data'

export function ProjectSettings({ session, onClose, onSession, onError, onTunnelConfigSaved }: {
  session: Session
  onClose: () => void
  onSession: (session: Session) => void
  onError: (message: string) => void
  onTunnelConfigSaved?: (config: TunnelProviderDocument, runtime?: AppConfig) => void
}) {
  const [config, setConfig] = useState<ProjectConfig>()
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
    api.artifactSettings().then((value) => { if (alive) { applyArtifactSettings(value) } }).catch(() => {})
    const bridge = desktopBridge()
    if (bridge) bridge.data.storage().then((value) => { if (alive) setDesktopStorage(value) }).catch(() => {})
    return () => { alive = false }
  }, [session.id, onError, reloadNonce])

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
    if (!config || saving) return
    setSaving(true)
    try {
      const next: ProjectConfig = { ...config, context: { ...config.context, max_file_bytes: miBToBytes(maxMiB), include: parsePatternLines(include), include_overrides: config.context.include_overrides || [], exclude: parsePatternLines(exclude) } }
      const result = await api.updateProjectConfig(session.id, next)
      setConfig(result.config); onSession(result.session)
      const nextInspection = await api.contextInspection(session.id)
      setInspection(nextInspection)
    } catch (error) { onError(messageOf(error, 'Não foi possível guardar a configuração do projeto')) }
    finally { setSaving(false) }
  }

  async function applyContextSelection(selection: ContextSelection) {
    if (!config || configuring) return
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
      setConfig(result.config)
      setInclude(formatPatternLines(result.config.context.include || []))
      setExclude(formatPatternLines(result.config.context.exclude || []))
      onSession(result.session)
      setInspection(await api.contextInspection(session.id))
    } catch (error) { onError(messageOf(error, `Não foi possível ${selection.action === 'include' ? 'incluir' : 'excluir'} ${selection.path}`)) }
    finally { setConfiguring(false) }
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

  async function clearAllWharnessData() {
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

  return <InternalWindow title="Configurações" layerClassName="project-settings-backdrop" onClose={onClose}>
    <section className="project-settings-dialog context-settings-dialog" role="dialog" aria-modal="false" aria-labelledby="project-settings-title">
      <header>
        <div className="settings-dialog-heading"><span className="settings-dialog-symbol"><Icon name="settings" size={18}/></span><div><span className="eyebrow">Preferências</span><h2 id="project-settings-title">Configurações</h2><p>Personalize o workbench e administre contexto, integrações e dados num espaço mais organizado.</p></div></div>
        <button className="icon-button" onClick={onClose} title="Fechar"><Icon name="close" size={16}/></button>
      </header>
      <div className="project-settings-body settings-layout">
        <nav className="settings-navigation" aria-label="Secções das configurações">
          <div className="settings-project-summary"><span>Projeto atual</span><strong>{session.project_path.split('/').filter(Boolean).pop() || session.project_path}</strong><small title={session.project_path}>{session.project_path}</small></div>
          <SettingsNavGroup label="Interface">
            <SettingsNavButton active={activeSection === 'appearance'} icon="monitor" label="Aparência" detail="Tema, cores e tipografia" onClick={() => setActiveSection('appearance')}/>
            <SettingsNavButton active={activeSection === 'composer'} icon="edit" label="Composer" detail="Pastes e anexos" onClick={() => setActiveSection('composer')}/>
            <SettingsNavButton active={activeSection === 'language'} icon="edit" label="Idioma" detail="Interface e tradução" onClick={() => setActiveSection('language')}/>
          </SettingsNavGroup>
          <SettingsNavGroup label="Projeto">
            <SettingsNavButton active={activeSection === 'context'} icon="file" label="Contexto" detail="Recorte enviado à IA" onClick={() => setActiveSection('context')}/>
          </SettingsNavGroup>
          <SettingsNavGroup label="Integrações">
            <SettingsNavButton active={activeSection === 'tunnel-provider'} icon="network" label="Tunnel Provider" detail="Transporte ChatGPT" onClick={() => setActiveSection('tunnel-provider')}/>
            <SettingsNavButton active={activeSection === 'remote-storage'} icon="database" label="Storage remoto" detail="Contas e limites" onClick={() => setActiveSection('remote-storage')}/>
          </SettingsNavGroup>
          <SettingsNavGroup label="Sistema">
            <SettingsNavButton active={activeSection === 'limits'} icon="shield" label="Limites" detail="Anexos e bundles por request" onClick={() => setActiveSection('limits')}/>
            <SettingsNavButton active={activeSection === 'data'} icon="shield" label="Dados locais" detail="Uso, retenção e limpeza" onClick={() => setActiveSection('data')}/>
          </SettingsNavGroup>
        </nav>
        <main className="settings-content">
        {activeSection === 'language' ? <LanguageSettingsPanel onError={onError}/> : null}
        {activeSection === 'composer' ? <section className="appearance-settings-section">
          <div className="settings-page-hero"><div><span className="eyebrow">Chat composer</span><strong>Pastes e anexos</strong><p>Controle quando textos colados viram anexos legíveis por @see e mantenha o composer leve.</p></div><code>{uiPreferences.largePasteThresholdChars.toLocaleString('pt-PT')} chars</code></div>
          <section className="settings-premium-card">
            <div className="settings-card-heading"><span><strong>Texto colado muito grande</strong><small>Acima do limite, o texto é anexado como Pasted Text em vez de ocupar o editor.</small></span><Icon name="file" size={16}/></div>
            <label className="settings-size"><span>Limite mínimo</span><div><input aria-label="Tamanho mínimo para transformar paste em anexo" type="number" min={1000} max={200000} step={500} value={uiPreferences.largePasteThresholdChars} onChange={(event) => { const next = saveUIPreferences({ ...uiPreferences, largePasteThresholdChars: Number(event.target.value) }); setUIPreferences(next) }}/><span>caracteres</span></div><small>Pastes menores continuam no editor. O padrão é 6 000 caracteres.</small></label>
          </section>
        </section> : null}
        {activeSection === 'appearance' ? <section className="appearance-settings-section">
          <div className="settings-page-hero"><div><span className="eyebrow">Interface</span><strong>Aparência do workbench</strong><p>Tema, contraste, densidade e tipografia com as mesmas cores da interface ativa.</p></div><code>{Math.round(uiPreferences.scale * 100)}%</code></div>
          <section className="settings-premium-card settings-theme-card">
            <div className="settings-card-heading"><span><strong>Tema e identidade</strong><small>Escolha o preset visual e a cor de destaque.</small></span><Icon name="monitor" size={16}/></div>
            <ThemePreferenceControl value={uiPreferences.theme} onChange={(theme) => { const next = saveUIPreferences({ ...uiPreferences, theme }); setUIPreferences(next) }} />
            <div className="accent-settings" aria-label="Cor de destaque">
              <span>Cor de destaque</span>
              <div>{UI_ACCENT_REGISTRY.map((accent) => <button key={accent.id} type="button" className={`accent-choice accent-${accent.id}${uiPreferences.accent === accent.id ? ' active' : ''}`} aria-label={`Destaque: ${accent.label}`} aria-pressed={uiPreferences.accent === accent.id} onClick={() => { const next = saveUIPreferences({ ...uiPreferences, accent: accent.id }); setUIPreferences(next) }}><i/><b>{accent.label}</b></button>)}</div>
            </div>
          </section>
          <div className="settings-premium-grid">
            <section className="settings-premium-card">
              <div className="settings-card-heading"><span><strong>Interface</strong><small>Como o conteúdo e as barras ocupam o espaço.</small></span><Icon name="workspace" size={16}/></div>
              <div className="typography-settings-grid workbench-appearance-grid">
                <label><span>Esquema do conteúdo</span><select value={uiPreferences.contentScheme} onChange={(event) => { const next = saveUIPreferences({ ...uiPreferences, contentScheme: event.target.value as UIPreferences['contentScheme'] }); setUIPreferences(next) }}><option value="follow-ui">Seguir interface</option><option value="original">Original</option><option value="dark">Escuro</option><option value="light">Claro</option><option value="high-contrast">Alto contraste</option></select></label>
                <label><span>Densidade</span><select value={uiPreferences.density} onChange={(event) => { const next = saveUIPreferences({ ...uiPreferences, density: event.target.value as UIPreferences['density'] }); setUIPreferences(next) }}><option value="default">Normal</option><option value="compact">Compacta</option></select></label>
                <label><span>Barras de ferramentas</span><select value={uiPreferences.toolRailPlacement} onChange={(event) => { const next = saveUIPreferences({ ...uiPreferences, toolRailPlacement: event.target.value as UIPreferences['toolRailPlacement'] }); setUIPreferences(next) }}><option value="sides">Laterais</option><option value="bottom">Cantos inferiores</option></select></label>
              </div>
            </section>
            <section className="settings-premium-card">
              <div className="settings-card-heading"><span><strong>Tipografia e escala</strong><small>Leitura consistente no editor e no chrome.</small></span><Icon name="edit" size={16}/></div>
              <div className="typography-settings-grid">
                <label><span>Fonte da interface</span><select value={uiPreferences.uiFont} onChange={(event) => { const next = saveUIPreferences({ ...uiPreferences, uiFont: event.target.value as UIPreferences['uiFont'] }); setUIPreferences(next) }}><option value="elegant">Elegante · Inter / Manrope</option><option value="system">Sistema · Segoe / nativa</option><option value="humanist">Humanista · Aptos / Calibri</option></select></label>
                <label><span>Fonte monoespaçada</span><select value={uiPreferences.monoFont} onChange={(event) => { const next = saveUIPreferences({ ...uiPreferences, monoFont: event.target.value as UIPreferences['monoFont'] }); setUIPreferences(next) }}><option value="jetbrains">JetBrains Mono</option><option value="system">Sistema Mono</option><option value="fira">Fira Code</option></select></label>
              </div>
              <label className="font-scale-setting"><span><strong>Tamanho da interface</strong><small>100% é o centro da escala e usa uma base maior; reduza até 40% ou amplie até 160%.</small></span><input type="range" min="0.4" max="1.6" step="0.05" value={uiPreferences.scale} onChange={(event) => { const next = saveUIPreferences({ ...uiPreferences, scale: Number(event.target.value) }); setUIPreferences(next) }}/><output>{Math.round(uiPreferences.scale * 100)}%</output></label>
            </section>
          </div>
          <section className="settings-premium-card settings-feedback-card"><div className="settings-card-heading"><span><strong>Feedback de erros</strong><small>Controle a forma como os avisos aparecem sem perder os detalhes no chat.</small></span><Icon name="bell" size={16}/></div><label className="settings-toggle"><input type="checkbox" checked={uiPreferences.errorPopups} onChange={(event) => { const next = saveUIPreferences({ ...uiPreferences, errorPopups: event.target.checked }); setUIPreferences(next) }}/><span><strong>Popups de erro</strong><small>Mostra apenas um aviso compacto e não bloqueante. Os detalhes completos continuam no chat e o aviso pode ser desativado.</small></span></label></section>
        </section> : null}
        {activeSection === 'context' ? (!config ? (loadingError
          ? <div className="settings-load-error"><Icon name="shield" size={22}/><div><strong>Não foi possível carregar a configuração</strong><p>{loadingError}</p><span>O backend tenta recriar automaticamente <code>whaness.yml</code> quando ele não existe. Pode tentar novamente sem fechar o projeto.</span><button className="secondary-button" onClick={() => setReloadNonce((value) => value + 1)}><Icon name="refresh" size={14}/> Tentar novamente</button></div></div>
          : <div className="settings-loading"><span className="settings-spinner"/>A carregar configuração…</div>) : <><section className="context-config-section">
          <div className="context-section-title"><div><strong>Configuração fina</strong><span>Estas opções alteram a próxima reconstrução do contexto.</span></div><div className="context-config-badges"><span>{config.context.include_overrides?.length || 0} inclusões explícitas</span><code>{session.context.manifest.sha256.slice(0, 12)}</code></div></div>
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
          {inspection ? <ContextInspector inspection={inspection} refreshing={refreshing} configuring={configuring} onRefresh={() => void refresh()} onSelection={(selection) => void applyContextSelection(selection)} /> : inspectionError ? <div className="context-inspection-error"><Icon name="shield" size={16}/><span>{inspectionError}</span><button onClick={() => setReloadNonce((value) => value + 1)}>Tentar novamente</button></div> : <div className="settings-loading compact"><span className="settings-spinner"/>A inspecionar o snapshot final…</div>}
        </section></>) : null}
        {activeSection === 'tunnel-provider' ? <TunnelProviderSettings onError={onError} onSaved={onTunnelConfigSaved}/> : null}
        {activeSection === 'remote-storage' ? <RemoteStorageSettings onError={onError}/> : null}
        {activeSection === 'limits' ? <section className="appearance-settings-section">
          <div className="context-section-title"><div><strong>Limites</strong><span>Configura a montagem e o transporte dos request bundles enviados ao ChatGPT.</span></div></div>
          <section className="settings-premium-card">
            <div className="settings-card-heading"><span><strong>Anexos do chat</strong><small>Zero desativa o limite de quantidade; o tamanho é governado pelo bundle completo.</small></span><Icon name="file" size={16}/></div>
            <label className="settings-size"><span>Número máximo de anexos por chat</span><div><input aria-label="Número máximo de anexos por chat" type="number" min={0} max={65500} value={attachmentCountLimit} onChange={(event) => setAttachmentCountLimit(Math.max(0, Math.min(65500, Number(event.target.value) || 0)))}/><span>{attachmentCountLimit === 0 ? 'sem limite' : 'ficheiros'}</span></div><small>Valor padrão: sem limite. A validação final ocorre no Desktop antes de montar o request.</small></label>
          </section>
          <section className="settings-premium-card">
            <div className="settings-card-heading"><span><strong>Bundles por request</strong><small>O Wharnex monta um bundle lógico e só o particiona quando ele ultrapassa o limite por bundle.</small></span><Icon name="shield" size={16}/></div>
            <div className="settings-grid">
              <label><span>Tamanho total do bundle</span><div><input aria-label="Tamanho total do bundle" type="number" min={1} max={4095} value={requestBundleTotalMiB} onChange={(event) => setRequestBundleTotalMiB(Math.max(1, Math.min(4095, Number(event.target.value) || 100)))}/><span> MiB</span></div><small>Padrão: 100 MiB. Limite do request lógico completo.</small></label>
              <label><span>Tamanho máximo por bundle</span><div><input aria-label="Tamanho máximo por bundle" type="number" min={1} max={256} value={requestBundlePartMiB} onChange={(event) => setRequestBundlePartMiB(Math.max(1, Math.min(256, Number(event.target.value) || 30)))}/><span> MiB</span></div><small>Padrão: 30 MiB. Acima disso, o request é dividido em partes remontáveis.</small></label>
              <label><span>Quantidade máxima de bundles por request</span><div><input aria-label="Quantidade máxima de bundles por request" type="number" min={1} max={20} value={requestBundlePartLimit} onChange={(event) => setRequestBundlePartLimit(Math.max(1, Math.min(20, Number(event.target.value) || 10)))}/><span>partes</span></div><small>Padrão: 10. Intervalo permitido: 1–20.</small></label>
            </div>
            <div className="settings-security-note"><Icon name="shield" size={16}/><span>Se o bundle lógico couber no tamanho máximo por bundle, o Wharnex envia exatamente um ZIP. Caso contrário, envia um ZIP principal e as partes seguintes com metadados de ordem, tamanho e SHA-256 para remontagem byte a byte.</span></div>
            <div className="context-config-actions"><button className="primary-button" disabled={storageBusy} onClick={() => void saveArtifactSettings('Falha ao guardar limites')}><Icon name="save" size={15}/>{storageBusy ? 'A guardar…' : 'Guardar limites'}</button></div>
          </section>
        </section> : null}
        {activeSection === 'data' ? <section className="wharness-data-section">
          <div className="context-section-title"><div><strong>Dados e armazenamento</strong><span>Sessão do navegador, métricas de disco e operações de limpeza do Wharnex.</span></div><button className="icon-button" disabled={storageBusy} onClick={() => void refreshStorage()} title="Atualizar métricas"><Icon name="refresh" size={15}/></button></div>
          <div className="storage-metrics">
            <StorageMetric label="Wharnex total" bytes={(backendStorage?.total_bytes || 0) + (desktopStorage?.total_bytes || 0)} />
            <StorageMetric label="Navegador interno" bytes={desktopStorage?.browser_bytes || 0} />
            <StorageMetric label="Anexos de chats" bytes={desktopStorage?.attachment_bytes || 0} />
            <StorageMetric label="Artefactos MinIO" bytes={backendStorage?.artifact_bytes || 0} />
            <StorageMetric label="Arquivos compactados" bytes={backendStorage?.archive_bytes || 0} />
            <StorageMetric label="Contextos/sandboxes" bytes={(backendStorage?.context_bytes || 0) + (backendStorage?.sandbox_bytes || 0)} />
            <StorageMetric label="Temporários/órfãos" bytes={(backendStorage?.orphan_bytes || 0) + (desktopStorage?.temp_bytes || 0)} />
          </div>
          <div className="project-storage-list">
            {(backendStorage?.projects || []).map((project) => <div key={project.project_path} className={project.project_path === session.project_path ? 'project-storage-row active' : 'project-storage-row'}><div><strong>{project.project_path === session.project_path ? 'Projeto atual' : project.project_path.split('/').filter(Boolean).pop()}</strong><span title={project.project_path}>{project.project_path}</span></div><code>{formatBytes(project.total_bytes)}</code></div>)}
            {!backendStorage?.projects?.length && <span className="muted-copy">Sem métricas de projeto disponíveis.</span>}
          </div>
          <div className="browser-session-actions">
            <div><strong>Retenção de artefactos no MinIO</strong><span>Bundles e ficheiros trocados são removidos automaticamente depois deste período. O padrão é 30 dias.</span></div>
            <div><input type="number" min={1} max={3650} value={artifactRetentionDays} onChange={(event) => setArtifactRetentionDays(Math.max(1, Math.min(3650, Number(event.target.value) || 30)))} style={{ width: 92 }}/><span> dias </span><button className="secondary-button" disabled={storageBusy} onClick={() => void saveArtifactSettings('Falha ao guardar retenção')}>Guardar</button></div>
          </div>
          <div className="browser-session-actions">
            <div><strong>Quota de bundles do ChatGPT</strong><span>Janela móvel de 3 horas. Esta é uma estimativa local do Wharnex: mede bundles enviados e recebidos em todos os chats conhecidos pela instância; o limite configurável aplica-se aos enviados e gera apenas alerta, sem bloquear novos pedidos.</span></div>
            <div><input aria-label="Máximo de bundles enviados em 3 horas" type="number" min={1} max={10000} value={bundleWindowLimit} onChange={(event) => setBundleWindowLimit(Math.max(1, Math.min(10000, Number(event.target.value) || 80)))} style={{ width: 92 }}/><span> envios / 3 h </span><button className="secondary-button" disabled={storageBusy} onClick={() => void saveArtifactSettings('Falha ao guardar quota de bundles')}>Guardar</button></div>
          </div>
          <div className="browser-session-actions">
            <div><strong>Sessão do navegador interno</strong><span>O ficheiro exportado pode conter uma sessão autenticada. Trate-o como segredo.</span></div>
            <div><button className="secondary-button" disabled={storageBusy || !desktopBridge()} onClick={() => void exportBrowserSession()}><Icon name="download" size={14}/> Exportar</button><button className="secondary-button" disabled={storageBusy || !desktopBridge()} onClick={() => void importBrowserSession()}><Icon name="apply" size={14}/> Importar</button><button className="secondary-button" disabled={storageBusy || !desktopBridge()} onClick={() => void clearBrowserSession()}><Icon name="close" size={14}/> Limpar sessão</button></div>
          </div>
          <div className="danger-zone">
            <div><strong>Limpar todos os dados do Wharnex</strong><span>Remove sessões, histórico local, contextos, sandboxes, anexos, temporários e sessão do navegador. Os ficheiros dos projetos reais não são apagados.</span></div>
            <label><span>Digite <code>APAGAR WHARNEX</code></span><input value={resetConfirm} onChange={(event) => setResetConfirm(event.target.value)} placeholder="APAGAR WHARNEX" /></label>
            <button className="danger-button" disabled={storageBusy || resetConfirm.trim() !== 'APAGAR WHARNEX'} onClick={() => void clearAllWharnessData()}>Limpar tudo</button>
          </div>
        </section> : null}
        </main>
      </div>
      <footer><span>{footerHint(activeSection)}</span><button className="secondary-button" onClick={onClose}>Fechar</button></footer>
    </section>
  </InternalWindow>
}

function StorageMetric({ label, bytes }: { label: string; bytes: number }) { return <div className="storage-metric"><span>{label}</span><strong>{formatBytes(bytes)}</strong></div> }

function SettingsNavGroup({ label, children }: { label: string; children: ReactNode }) {
  return <div className="settings-nav-group"><span className="settings-nav-group-label">{label}</span>{children}</div>
}

function SettingsNavButton({ active, icon, label, detail, onClick }: { active: boolean; icon: 'monitor' | 'edit' | 'file' | 'network' | 'database' | 'shield'; label: string; detail: string; onClick: () => void }) {
  return <button className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={onClick}><Icon name={icon} size={16}/><span><strong>{label}</strong><small>{detail}</small></span></button>
}

function footerHint(section: SettingsSection) {
  if (section === 'remote-storage') return 'A configuração de storage é global e aplica-se a todos os projetos após reiniciar.'
  if (section === 'data') return 'Os ficheiros dos projetos reais não são removidos pelas operações desta secção.'
  if (section === 'limits') return 'Os limites são globais e passam a valer na preparação do próximo request bundle.'
  if (section === 'appearance') return 'Preferências visuais ficam apenas neste dispositivo.'
  if (section === 'composer') return 'Preferências do composer ficam apenas neste dispositivo.'
  if (section === 'language') return 'Idioma é global; traduções Markdown são temporárias e nunca reescrevem o ficheiro original.'
  return 'Snapshot final = lista exata enviada ao ChatGPT/Planner.'
}

function messageOf(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback }
function uniquePatterns(values: string[]) { return Array.from(new Set(values)) }
function patternContains(parent: string, candidate: string) { const prefix = parent.endsWith('/**') ? parent.slice(0, -3) : ''; return candidate === parent || Boolean(prefix && (candidate === prefix || candidate.startsWith(`${prefix}/`))) }
