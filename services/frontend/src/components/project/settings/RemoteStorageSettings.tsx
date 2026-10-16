import { Button, EmptyState } from '../../presentation/workbench'
import { ConnectionSettingsFrame, ConnectionSaveBar, ConnectionStatus } from './connections'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../../../lib/transport/http/api'
import { confirmDialog } from '../../../lib/desktop/bridge/appDialog'
import type { RemoteStorageInstance, RemoteStorageLimits, RemoteStorageProvider, RemoteStorageProviderID } from '../../../types'
import { Icon } from '../../presentation/chrome/Icon'

const EMPTY_LIMITS: RemoteStorageLimits = { max_requests: 0, window_seconds: 0, max_files_per_input: 0, max_file_bytes: 0, max_input_bytes: 0, max_stored_objects: 0, max_storage_bytes: 0 }
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const MIB = 1024 * 1024
const GIB = 1024 * MIB
const PUBLIC_URL_PROVIDERS = new Set<RemoteStorageProviderID>(['s3', 'webdav', 'nextcloud'])

export function RemoteStorageSettings({ onError }: { onError: (message: string) => void }) {
  const [instances, setInstances] = useState<RemoteStorageInstance[]>()
  const [providers, setProviders] = useState<RemoteStorageProvider[]>()
  const [showCatalog, setShowCatalog] = useState(false)
  const [connecting, setConnecting] = useState<number>()
  const [checking, setChecking] = useState<number>()
  const [connectionFields, setConnectionFields] = useState<Record<string, Record<string, string>>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [cleanupWarning, setCleanupWarning] = useState(false)
  const [loadingError, setLoadingError] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let alive = true
    setLoadingError('')
    Promise.all([api.remoteStorageConfig(), api.remoteStorageProviders()]).then(([stored, catalog]) => {
      if (!alive) return
      setInstances((stored.config.instances || []).filter(({ provider }) => provider !== 'trycloudflare').map(normalizeInstance))
      setProviders((catalog.providers || []).map(normalizeProvider))
    }).catch((error) => { if (alive) { const message = messageOf(error, 'Não foi possível carregar os storages remotos'); setLoadingError(message); onError(message) } })
    return () => { alive = false }
  }, [onError, revision])

  function addInstance(provider: RemoteStorageProvider) {
    setSaved(false); setShowCatalog(false)
    setInstances((current) => {
      const values = current || []
      const used = new Set(values.map(({ id }) => id))
      const base = provider.id.replace(/[^a-z0-9-]/g, '-')
      let suffix = 1
      while (used.has(`${base}-${suffix}`)) suffix += 1
      const priority = values.reduce((largest, item) => Math.max(largest, item.priority), 0) + 10
      return [...values, { id: `${base}-${suffix}`, provider: provider.id, priority, limits: { ...EMPTY_LIMITS }, rclone_prefix: 'wharness-inputs' }]
    })
  }

  function update(index: number, patch: Partial<RemoteStorageInstance>) {
    setSaved(false)
    setInstances((current) => current?.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  }

  function updateLimit(index: number, key: keyof RemoteStorageLimits, value: number) {
    const instance = instances?.[index]
    if (instance) update(index, { limits: { ...instance.limits, [key]: Math.max(0, Math.round(value || 0)) } })
  }

  function move(index: number, direction: -1 | 1) {
    setSaved(false)
    setInstances((current) => {
      if (!current) return current
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const reordered = [...current]
      ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
      return reordered.map((item, itemIndex) => ({ ...item, priority: (itemIndex + 1) * 10 }))
    })
  }

  async function connect(index: number, provider: RemoteStorageProvider) {
    const instance = instances?.[index]
    if (!instance || connecting !== undefined) return
    if (!ID_PATTERN.test(instance.id)) return onError('Defina um identificador válido antes de ligar a conta.')
    const fields = connectionFields[instance.id] || {}
    for (const field of provider.fields) if (field.required && !fields[field.id]?.trim()) return onError(`Preencha “${field.label}”.`)
    setConnecting(index)
    try {
      const connection = await api.connectRemoteStorage(instance.id, provider.id, fields)
      update(index, { rclone_remote: connection.remote })
      setConnectionFields((current) => { const next = { ...current }; delete next[instance.id]; return next })
    } catch (error) { onError(messageOf(error, 'Não foi possível autenticar o provider')) }
    finally { setConnecting(undefined) }
  }

  async function check(index: number) {
    const remote = instances?.[index]?.rclone_remote
    if (!remote || checking !== undefined) return
    setChecking(index)
    try { await api.checkRemoteStorage(remote) }
    catch (error) { onError(messageOf(error, 'A ligação ao storage falhou')) }
    finally { setChecking(undefined) }
  }

  async function remove(index: number) {
    const instance = instances?.[index]
    if (!instance) return
    if (instance.rclone_remote) {
      const confirmed = await confirmDialog({ title: `Remover ${providerName(instance.provider, providers)}?`, message: 'A conta será retirada do pool quando guardar a configuração. As credenciais geridas serão removidas depois da gravação; os ficheiros já enviados permanecem sujeitos à retenção configurada.', tone: 'danger', confirmLabel: 'Remover do pool' })
      if (!confirmed) return
    }
    setSaved(false); setInstances((current) => current?.filter((_, itemIndex) => itemIndex !== index))
  }

  async function save() {
    if (!instances || saving) return
    const validationError = validate(instances)
    if (validationError) return onError(validationError)
    setSaving(true)
    try {
      const result = await api.updateRemoteStorageConfig({ version: 1, instances: instances.map(cleanInstance) })
      setInstances((result.config.instances || []).map(normalizeInstance)); setSaved(result.restart_required); setCleanupWarning(Boolean(result.credential_cleanup_warning))
    } catch (error) { onError(messageOf(error, 'Não foi possível guardar os storages remotos')) }
    finally { setSaving(false) }
  }

  if (!instances || !providers) return loadingError ? <EmptyState icon="alert" title="Não foi possível carregar os providers" description={loadingError} action={<Button icon="refresh" onClick={() => setRevision((value) => value + 1)}>Tentar novamente</Button>}/>
    : <p className="p-6 text-whx-label text-whx-faint" role="status">A carregar providers…</p>

  return <ConnectionSettingsFrame title="Contas de armazenamento" description="Estas contas permanecem configuradas para funcionalidades de storage. Não participam no transporte de pedidos para o ChatGPT." notice={<>Credenciais ficam na configuração privada do rclone e nunca entram no projeto ou no prompt. Objetos remotos são removidos após <strong>7 dias</strong>.</>} catalogOpen={showCatalog} onCatalog={() => setShowCatalog((value) => !value)}>
    {saved ? <ConnectionStatus warning>{cleanupWarning ? 'Reinicie para ativar. Algumas credenciais antigas não puderam ser removidas automaticamente.' : 'Reinicie o Wharnex para ativar o novo pool.'}</ConnectionStatus> : null}
    {showCatalog ? <ProviderCatalog providers={providers} onSelect={addInstance}/> : null}

    <div className="remote-instance-list">
      {instances.length === 0 && !showCatalog ? <div className="remote-storage-empty"><Icon name="network" size={26}/><strong>Sem storage remoto configurado</strong><span>Pode adicionar drivers agora e escolher a finalidade deles numa funcionalidade futura.</span><button className="primary-button" onClick={() => setShowCatalog(true)}><Icon name="plus" size={14}/> Escolher provider</button></div> : null}
      {instances.map((instance, index) => {
        const provider = providers.find(({ id }) => id === instance.provider) || legacyProvider(instance.provider)
        const connected = Boolean(instance.rclone_remote) || instance.provider === 'http' || instance.provider === 'trycloudflare'
        return <article className="remote-instance-card" key={`storage-instance-${index}`}>
          <header><div className={`provider-mark provider-${instance.provider}`}>{providerInitials(provider.name)}</div><div><strong>{provider.name}</strong><span>{instance.id} · prioridade {instance.priority}</span></div><span className={connected ? 'connection-state connected' : 'connection-state'}><i/>{connected ? 'Ligado' : 'Por ligar'}</span><div className="remote-instance-actions"><button className="icon-button" disabled={index === 0} onClick={() => move(index, -1)} title="Subir na prioridade"><Icon name="arrow-up" size={14}/></button><button className="icon-button" disabled={index === instances.length - 1} onClick={() => move(index, 1)} title="Descer na prioridade"><Icon name="arrow-down" size={14}/></button><button className="icon-button danger" onClick={() => void remove(index)} title="Remover instância"><Icon name="trash" size={14}/></button></div></header>
          <div className="remote-instance-grid identity"><Field label="Nome desta conta" hint="Usado apenas pelo Wharnex"><input value={instance.id} disabled={connected && instance.provider !== 'http'} onChange={(event) => update(index, { id: event.target.value })}/></Field><Field label="Prioridade" hint="Menor valor é tentado primeiro"><input type="number" min={0} value={instance.priority} onChange={(event) => update(index, { priority: numeric(event.target.value) })}/></Field><Field label="Pasta dos contextos"><input value={instance.rclone_prefix || ''} onChange={(event) => update(index, { rclone_prefix: event.target.value })}/></Field></div>
          {instance.provider === 'http' ? <LegacyHTTPFields instance={instance} index={index} update={update}/> : instance.provider === 'trycloudflare' ? <div className="provider-connection-panel"><p className="legacy-provider-note">O Wharnex abre um canal temporário e secreto por tarefa, com prompt, hash, contexto, anexos e eventos. Nenhuma rota do backend ou ficheiro arbitrário é exposto.</p></div> : <div className="provider-connection-panel">
            {!connected ? <><div className="remote-instance-grid connection-fields">{provider.fields.map((field) => <Field key={field.id} label={field.label}><input type={field.secret ? 'password' : 'text'} autoComplete="off" placeholder={field.placeholder} value={connectionFields[instance.id]?.[field.id] || ''} onChange={(event) => setConnectionFields((current) => ({ ...current, [instance.id]: { ...(current[instance.id] || {}), [field.id]: event.target.value } }))}/></Field>)}</div><div className="connect-provider-row"><div><strong>{provider.auth_mode === 'oauth_browser' ? 'Autenticação segura pelo navegador' : 'Guardar credenciais no rclone'}</strong><span>{provider.auth_mode === 'oauth_browser' ? 'Uma janela externa será aberta. Volte aqui depois de autorizar.' : 'Os valores são enviados uma vez e não ficam no estado do frontend.'}</span></div><button className="primary-button" disabled={!provider.available || connecting !== undefined} onClick={() => void connect(index, provider)}><Icon name="external" size={14}/>{connecting === index ? 'A aguardar autorização…' : provider.auth_mode === 'oauth_browser' ? `Ligar ${provider.name}` : 'Guardar e ligar'}</button></div></> : <div className="connected-provider-row"><div><Icon name="check" size={16}/><span><strong>Conta ligada</strong><small>{instance.rclone_remote}</small></span></div><button className="secondary-button compact" disabled={checking !== undefined} onClick={() => void check(index)}><Icon name="refresh" size={13}/>{checking === index ? 'A testar…' : 'Testar ligação'}</button></div>}
            {PUBLIC_URL_PROVIDERS.has(instance.provider) ? <div className="remote-instance-grid public-access"><Field label="URL pública da pasta" hint="HTTPS; utilizada pelo ChatGPT para descarregar"><input type="url" placeholder="https://files.example/wharness" value={instance.public_url || ''} onChange={(event) => update(index, { public_url: event.target.value })}/></Field></div> : null}
          </div>}
          <LimitEditor instance={instance} index={index} updateLimit={updateLimit}/>
        </article>
      })}
    </div>
    <ConnectionSaveBar count={instances.length} noun={instances.length === 1 ? 'conta configurada' : 'contas configuradas'} busy={saving} onSave={() => void save()}/>
  </ConnectionSettingsFrame>
}

function ProviderCatalog({ providers, onSelect }: { providers: RemoteStorageProvider[]; onSelect: (provider: RemoteStorageProvider) => void }) { const available = providers.some((provider) => provider.available); return <section className="provider-catalog" aria-label="Providers disponíveis"><header><div><strong>Escolha um storage</strong><span>{available ? 'É possível adicionar várias contas do mesmo provider.' : 'Instale rclone para ativar os providers.'}</span></div></header><div>{providers.map((provider) => <button key={provider.id} disabled={!provider.available} title={provider.available ? undefined : 'rclone não está instalado'} onClick={() => onSelect(provider)}><span className={`provider-mark provider-${provider.id}`}>{providerInitials(provider.name)}</span><span><strong>{provider.name}</strong><small>{provider.description}</small></span><Icon name="chevron" size={14}/></button>)}</div></section> }
function LegacyHTTPFields({ instance, index, update }: { instance: RemoteStorageInstance; index: number; update: (index: number, patch: Partial<RemoteStorageInstance>) => void }) { return <div className="provider-connection-panel"><p className="legacy-provider-note">Configuração avançada importada. Novas contas devem usar WebDAV ou um provider do catálogo.</p><div className="remote-instance-grid"><Field label="Endpoint de upload"><input value={instance.upload_url || ''} onChange={(event) => update(index, { upload_url: event.target.value })}/></Field><Field label="URL pública"><input value={instance.public_url || ''} onChange={(event) => update(index, { public_url: event.target.value })}/></Field><Field label="Variável de autorização"><input value={instance.authorization_env || ''} onChange={(event) => update(index, { authorization_env: event.target.value.toUpperCase() })}/></Field></div></div> }
function LimitEditor({ instance, index, updateLimit }: { instance: RemoteStorageInstance; index: number; updateLimit: (index: number, key: keyof RemoteStorageLimits, value: number) => void }) { return <details className="remote-limits"><summary><span><strong>Limites desta conta</strong><small>Zero significa ilimitado</small></span><Icon name="chevron" size={14}/></summary><div className="remote-limit-grid"><Limit label="Requisições" value={instance.limits.max_requests} onChange={(value) => updateLimit(index, 'max_requests', value)}/><Limit label="Janela" unit="seg" value={instance.limits.window_seconds} onChange={(value) => updateLimit(index, 'window_seconds', value)}/><Limit label="Ficheiros / envio" value={instance.limits.max_files_per_input} onChange={(value) => updateLimit(index, 'max_files_per_input', value)}/><Limit label="Tamanho / ficheiro" unit="MiB" scale={MIB} value={instance.limits.max_file_bytes} onChange={(value) => updateLimit(index, 'max_file_bytes', value)}/><Limit label="Tamanho / envio" unit="MiB" scale={MIB} value={instance.limits.max_input_bytes} onChange={(value) => updateLimit(index, 'max_input_bytes', value)}/><Limit label="Objetos armazenados" value={instance.limits.max_stored_objects} onChange={(value) => updateLimit(index, 'max_stored_objects', value)}/><Limit label="Capacidade total" unit="GiB" scale={GIB} value={instance.limits.max_storage_bytes} onChange={(value) => updateLimit(index, 'max_storage_bytes', value)}/></div></details> }
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) { return <label><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label> }
function Limit({ label, unit, scale = 1, value, onChange }: { label: string; unit?: string; scale?: number; value: number; onChange: (value: number) => void }) { return <label><span>{label}</span><div><input type="number" min={0} step={scale === 1 ? 1 : 0.1} value={value ? Number((value / scale).toFixed(2)) : 0} onChange={(event) => onChange(numeric(event.target.value) * scale)}/>{unit ? <small>{unit}</small> : null}</div></label> }
function normalizeInstance(instance: RemoteStorageInstance): RemoteStorageInstance { return { ...instance, limits: { ...EMPTY_LIMITS, ...(instance.limits || {}) } } }
function normalizeProvider(provider: RemoteStorageProvider): RemoteStorageProvider { return { ...provider, fields: Array.isArray(provider.fields) ? provider.fields : [] } }
function cleanInstance(instance: RemoteStorageInstance): RemoteStorageInstance { return { ...instance, id: instance.id.trim(), rclone_remote: instance.rclone_remote?.trim() || undefined, rclone_prefix: instance.rclone_prefix?.trim() || undefined, public_url: instance.public_url?.trim() || undefined, upload_url: instance.upload_url?.trim() || undefined, authorization_env: instance.authorization_env?.trim() || undefined } }
function validate(instances: RemoteStorageInstance[]) { const ids = new Set<string>(); for (const instance of instances) { if (!ID_PATTERN.test(instance.id)) return `O identificador “${instance.id || '(vazio)'}” é inválido.`; if (ids.has(instance.id)) return `O identificador “${instance.id}” está repetido.`; ids.add(instance.id); if (instance.priority < 0) return `A prioridade de “${instance.id}” não pode ser negativa.`; if (instance.limits.max_requests > 0 && instance.limits.window_seconds <= 0) return `Defina a janela de requisições de “${instance.id}”.`; if (instance.provider !== 'http' && instance.provider !== 'trycloudflare' && !instance.rclone_remote) return `Ligue a conta “${instance.id}” antes de guardar.`; if (PUBLIC_URL_PROVIDERS.has(instance.provider) && !instance.public_url?.startsWith('https://')) return `Defina uma URL pública HTTPS para “${instance.id}”.`; if (instance.provider === 'http' && (!instance.upload_url || !instance.public_url)) return `Complete os endpoints HTTP de “${instance.id}”.` } return '' }
function legacyProvider(id: RemoteStorageProviderID): RemoteStorageProvider { return { id, name: id === 'rclone' ? 'rclone avançado' : 'HTTP personalizado', description: 'Configuração importada', auth_mode: 'credentials', available: true, fields: [] } }
function providerName(id: RemoteStorageProviderID, providers?: RemoteStorageProvider[]) { return providers?.find((provider) => provider.id === id)?.name || id }
function providerInitials(name: string) { return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() }
function numeric(value: string) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(0, parsed) : 0 }
function messageOf(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback }
