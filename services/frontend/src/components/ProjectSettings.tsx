import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { bytesToMiB, formatPatternLines, miBToBytes, parsePatternLines } from '../lib/projectConfig'
import type { ContextInspection, ProjectConfig, Session } from '../types'
import { ContextInspector } from './ContextInspector'
import { Icon } from './Icon'

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

  return <div className="project-settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
    <section className="project-settings-dialog context-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="project-settings-title">
      <header>
        <div><span className="eyebrow">Projeto</span><h2 id="project-settings-title">Contexto do Wharness</h2><p><code>whaness.yml</code> controla o recorte; o explorador abaixo mostra o que realmente entrou no ZIP.</p></div>
        <button className="icon-button" onClick={onClose} title="Fechar"><Icon name="close" size={16}/></button>
      </header>
      {!config ? (loadingError
        ? <div className="settings-load-error"><Icon name="shield" size={22}/><div><strong>Não foi possível carregar a configuração</strong><p>{loadingError}</p><span>O backend tenta recriar automaticamente <code>whaness.yml</code> quando ele não existe. Pode tentar novamente sem fechar o projeto.</span><button className="secondary-button" onClick={() => setReloadNonce((value) => value + 1)}><Icon name="refresh" size={14}/> Tentar novamente</button></div></div>
        : <div className="settings-loading"><span className="settings-spinner"/>A carregar configuração…</div>) : <div className="project-settings-body">
        <section className="context-config-section">
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
        </section>
      </div>}
      <footer><span>Snapshot final = lista exata enviada ao ChatGPT/Planner.</span><button className="secondary-button" onClick={onClose}>Fechar</button></footer>
    </section>
  </div>
}

function messageOf(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback }
