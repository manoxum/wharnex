import { WorkbenchTabs } from '../../presentation/tabs'
import { useState } from 'react'
import { api } from '../../../lib/transport/http/api'
import { confirmDialog } from '../../../lib/desktop/bridge/appDialog'
import type { PostgresCatalog, PostgresConnectionInput, PostgresQueryResult } from '../../../types'
import { DatabaseDataBrowser } from './DatabaseDataBrowser'
import { DatabaseObjectBrowser } from './DatabaseObjectBrowser'
import { Icon } from '../../presentation/chrome/Icon'
import {
  buildDatabaseMetadata, DATABASE_METADATA_SQL, EMPTY_DATABASE_METADATA, tableDDL, type DatabaseMetadata,
} from './databaseExplorerUtils'

type SavedProfile = Omit<PostgresConnectionInput, 'password'> & { id: string; name: string }
type DatabaseTab = 'connection' | 'objects' | 'data' | 'sql'
type WritePrompt = { title: string; message: string; confirmLabel: string }
const PROFILE_KEY = 'whx.database.postgres-profiles'
const DEFAULT_CONNECTION: PostgresConnectionInput = { host: '127.0.0.1', port: 5432, database: 'postgres', user: 'postgres', password: '', sslmode: 'disable' }

export function DatabaseExplorerPanel({ onError }: { onError: (message: string) => void }) {
  const [profiles, setProfiles] = useState<SavedProfile[]>(loadProfiles)
  const [profileName, setProfileName] = useState('PostgreSQL local')
  const [connection, setConnection] = useState<PostgresConnectionInput>(DEFAULT_CONNECTION)
  const [catalog, setCatalog] = useState<PostgresCatalog>()
  const [metadata, setMetadata] = useState<DatabaseMetadata>(EMPTY_DATABASE_METADATA)
  const [tab, setTab] = useState<DatabaseTab>('connection')
  const [sql, setSQL] = useState('SELECT now();')
  const [ddl, setDDL] = useState(tableDDL())
  const [readOnly, setReadOnly] = useState(true)
  const [result, setResult] = useState<PostgresQueryResult>()
  const [status, setStatus] = useState('')
  const [connected, setConnected] = useState(false)
  const [busy, setBusy] = useState(false)
  const update = <K extends keyof PostgresConnectionInput>(key: K, value: PostgresConnectionInput[K]) => setConnection((current) => ({ ...current, [key]: value }))

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    setBusy(true)
    try { return await action() } catch (error) { onError(messageOf(error)); return undefined } finally { setBusy(false) }
  }

  async function test() {
    setStatus('A testar ligação...')
    const response = await run(() => api.testPostgres(connection))
    if (response) { setConnected(true); setStatus('Ligação PostgreSQL validada com sucesso.') }
  }

  async function inspect(activateObjects = true) {
    setStatus('A carregar catálogo e metadados...')
    const response = await run(async () => {
      const [nextCatalog, primaryKeys, views, functions, triggers] = await Promise.all([
        api.postgresCatalog(connection),
        api.queryPostgres(connection, DATABASE_METADATA_SQL.primaryKeys, true),
        api.queryPostgres(connection, DATABASE_METADATA_SQL.views, true),
        api.queryPostgres(connection, DATABASE_METADATA_SQL.functions, true),
        api.queryPostgres(connection, DATABASE_METADATA_SQL.triggers, true),
      ])
      return { nextCatalog, metadata: buildDatabaseMetadata({ primaryKeys, views, functions, triggers }) }
    })
    if (!response) return
    setCatalog(response.nextCatalog); setMetadata(response.metadata); setConnected(true)
    setStatus(`${response.nextCatalog.tables.length} tabela(s)/view(s), ${response.metadata.functions.length} função(ões) e ${response.metadata.triggers.length} trigger(s) carregados.`)
    if (activateObjects) setTab('objects')
  }

  async function readSQL(statement: string) {
    const next = await run(() => api.queryPostgres(connection, statement, true))
    if (next) setStatus(`${next.row_count} linha(s) · ${next.duration_ms} ms${next.truncated ? ' · resultado truncado' : ''}`)
    return next
  }

  async function writeSQL(statement: string, prompt: WritePrompt) {
    const ok = await confirmDialog({ title: prompt.title, message: prompt.message, tone: 'warning', confirmLabel: prompt.confirmLabel })
    if (!ok) return undefined
    const next = await run(() => api.queryPostgres(connection, statement, false))
    if (next) setStatus(`Operação concluída · ${next.row_count} linha(s) · ${next.duration_ms} ms`)
    return next
  }

  async function executeConsole() {
    const next = readOnly ? await readSQL(sql) : await writeSQL(sql, { title: 'Executar SQL com escrita?', message: 'Este comando pode alterar estrutura ou dados na base selecionada. Confirme apenas depois de rever o SQL.', confirmLabel: 'Executar SQL' })
    if (next) setResult(next)
  }

  async function applyDDL() {
    const next = await writeSQL(ddl, { title: 'Aplicar alteração de estrutura?', message: 'O DDL selecionado pode criar ou alterar objetos PostgreSQL. Confirme depois de rever todo o comando.', confirmLabel: 'Aplicar DDL' })
    if (next) await inspect(false)
  }

  function saveProfile() {
    const next: SavedProfile = { id: crypto.randomUUID(), name: profileName.trim() || 'PostgreSQL', host: connection.host, port: connection.port, database: connection.database, user: connection.user, sslmode: connection.sslmode }
    const merged = [...profiles.filter((item) => item.name !== next.name), next]
    setProfiles(merged); persistProfiles(merged); setStatus('Perfil guardado sem password.')
  }
  function loadProfile(profile: SavedProfile) {
    setProfileName(profile.name); setConnection({ host: profile.host, port: profile.port, database: profile.database, user: profile.user, password: '', sslmode: profile.sslmode })
    setCatalog(undefined); setMetadata(EMPTY_DATABASE_METADATA); setResult(undefined); setConnected(false); setTab('connection'); setStatus('Perfil carregado. Introduza a password para ligar.')
  }
  function deleteProfile(id: string) { const next = profiles.filter((item) => item.id !== id); setProfiles(next); persistProfiles(next) }

  return <section className="right-tool-panel database-explorer-panel">
    <header className="database-studio-header"><div className="database-studio-identity"><span className="database-studio-mark"><Icon name="database" size={18}/></span><div><strong>Database Studio</strong><span>PostgreSQL</span></div></div><span className={`database-health ${connected ? 'ready' : ''}`}><i/>{connected ? 'Ligado' : 'Desligado'}</span></header>
    <WorkbenchTabs label="Database Studio" value={tab} onChange={setTab} items={[
      { id: 'connection', label: 'Conexão', icon: 'link' }, { id: 'objects', label: 'Objetos', icon: 'database' },
      { id: 'data', label: 'Dados', icon: 'list' }, { id: 'sql', label: 'SQL', icon: 'code' },
    ]}/>
    {status && <div className="database-status"><span>{status}</span>{catalog && <button type="button" onClick={() => void inspect(false)} disabled={busy} aria-label="Atualizar catálogo"><Icon name="refresh" size={14}/></button>}</div>}
    {tab === 'connection' && <ConnectionPanel profiles={profiles} profileName={profileName} connection={connection} busy={busy} connected={connected} onProfileName={setProfileName} onUpdate={update} onSave={saveProfile} onLoad={loadProfile} onDelete={deleteProfile} onTest={() => void test()} onInspect={() => void inspect()}/>}
    {tab === 'objects' && (catalog ? <DatabaseObjectBrowser catalog={catalog} metadata={metadata} ddl={ddl} busy={busy} onDDL={setDDL} onApplyDDL={() => void applyDDL()}/> : <ConnectEmpty onInspect={() => void inspect()} busy={busy}/>)}
    {tab === 'data' && (catalog ? <DatabaseDataBrowser catalog={catalog} metadata={metadata} busy={busy} onRead={readSQL} onWrite={writeSQL} onError={onError}/> : <ConnectEmpty onInspect={() => void inspect()} busy={busy}/>)}
    {tab === 'sql' && <div className="database-query database-query-modern"><header><div><span>SQL console</span><strong>Consulta livre</strong></div><label><input type="checkbox" checked={readOnly} onChange={(event) => setReadOnly(event.target.checked)}/> Só leitura</label></header><textarea value={sql} onChange={(event) => setSQL(event.target.value)} spellCheck={false}/><div className="database-editor-actions"><span>{readOnly ? 'Modo protegido: a transação é aberta como read-only.' : 'Modo de escrita: será pedida confirmação antes de executar.'}</span><button type="button" className="database-primary-button" disabled={busy || !sql.trim()} onClick={() => void executeConsole()}><Icon name="play" size={13}/> Executar</button></div>{result && <QueryResult result={result}/>}</div>}
  </section>
}

type ConnectionProps = {
  profiles: SavedProfile[]; profileName: string; connection: PostgresConnectionInput; busy: boolean; connected: boolean
  onProfileName: (value: string) => void; onUpdate: <K extends keyof PostgresConnectionInput>(key: K, value: PostgresConnectionInput[K]) => void
  onSave: () => void; onLoad: (profile: SavedProfile) => void; onDelete: (id: string) => void; onTest: () => void; onInspect: () => void
}
function ConnectionPanel({ profiles, profileName, connection, busy, connected, onProfileName, onUpdate, onSave, onLoad, onDelete, onTest, onInspect }: ConnectionProps) {
  return <div className="database-panel-scroll">
    <div className="database-connection-overview"><span className="database-connection-logo"><Icon name="database" size={22}/></span><div><span>Workspace atual</span><strong>{connection.database || 'PostgreSQL'}</strong><small>{connection.user || 'user'}@{connection.host || 'host'}:{connection.port || 5432}</small></div><span className={connected ? 'ready' : ''}>{connected ? 'Pronto' : 'Configurar'}</span></div>
    <section className="database-connection-section"><header><div><span>Perfis</span><strong>Conexões guardadas</strong></div><small>Passwords nunca são persistidas</small></header><div className="database-profile-strip">{profiles.map((profile) => <div key={profile.id}><button type="button" onClick={() => onLoad(profile)}><strong>{profile.name}</strong><small>{profile.user}@{profile.host}:{profile.port}/{profile.database}</small></button><button type="button" onClick={() => onDelete(profile.id)} aria-label={`Eliminar ${profile.name}`}><Icon name="close" size={14}/></button></div>)}{!profiles.length && <span>Nenhum perfil guardado.</span>}</div></section>
    <section className="database-connection-section"><header><div><span>Credenciais</span><strong>Detalhes da ligação</strong></div></header><div className="database-connection-form">
      <label className="wide"><span>Nome do perfil</span><input value={profileName} onChange={(event) => onProfileName(event.target.value)}/></label>
      <label><span>Host</span><input value={connection.host} onChange={(event) => onUpdate('host', event.target.value)}/></label>
      <label><span>Porta</span><input type="number" min={1} max={65535} value={connection.port} onChange={(event) => onUpdate('port', Number(event.target.value) || 5432)}/></label>
      <label><span>Database</span><input value={connection.database} onChange={(event) => onUpdate('database', event.target.value)}/></label>
      <label><span>Utilizador</span><input value={connection.user} onChange={(event) => onUpdate('user', event.target.value)}/></label>
      <label><span>Password</span><input type="password" value={connection.password} onChange={(event) => onUpdate('password', event.target.value)} autoComplete="new-password"/></label>
      <label><span>SSL mode</span><select value={connection.sslmode} onChange={(event) => onUpdate('sslmode', event.target.value as PostgresConnectionInput['sslmode'])}><option>disable</option><option>allow</option><option>prefer</option><option>require</option><option>verify-ca</option><option>verify-full</option></select></label>
    </div><div className="database-connection-actions"><button type="button" disabled={busy} onClick={onSave}><Icon name="save" size={13}/> Guardar perfil</button><button type="button" disabled={busy} onClick={onTest}><Icon name="check" size={13}/> Testar</button><button type="button" className="primary" disabled={busy} onClick={onInspect}><Icon name="database" size={13}/> Ligar e explorar</button></div></section>
  </div>
}

function ConnectEmpty({ onInspect, busy }: { onInspect: () => void; busy: boolean }) {
  return <div className="database-connect-empty"><span className="database-studio-mark large"><Icon name="database" size={24}/></span><strong>Ligue à base para abrir o explorador</strong><span>Carregue tabelas, views, funções, triggers e chaves primárias para usar as ferramentas visuais.</span><button type="button" className="database-primary-button" disabled={busy} onClick={onInspect}><Icon name="database" size={13}/> Ligar e explorar</button></div>
}

function QueryResult({ result }: { result: PostgresQueryResult }) {
  return <div className="database-result"><div>{result.row_count} linha(s){result.truncated ? ' · primeiras 500' : ''}</div>{result.columns.length ? <div className="database-result-scroll"><table><thead><tr>{result.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{result.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, columnIndex) => <td key={columnIndex}>{formatCell(value)}</td>)}</tr>)}</tbody></table></div> : <p>Comando executado sem conjunto de resultados.</p>}</div>
}
function formatCell(value: unknown) { if (value === null) return 'NULL'; if (typeof value === 'object') { try { return JSON.stringify(value) } catch { return String(value) } } return String(value) }
function loadProfiles(): SavedProfile[] { try { const parsed = JSON.parse(localStorage.getItem(PROFILE_KEY) || '[]'); return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.name === 'string' && typeof item.host === 'string') : [] } catch { return [] } }
function persistProfiles(items: SavedProfile[]) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(items)) } catch { /* best effort */ } }
function messageOf(error: unknown) { return error instanceof Error ? error.message : String(error) }
