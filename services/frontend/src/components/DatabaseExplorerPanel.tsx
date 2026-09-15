import { useMemo, useState } from 'react'
import { api } from '../lib/api'
import { confirmDialog } from '../lib/appDialog'
import type { PostgresCatalog, PostgresConnectionInput, PostgresQueryResult } from '../types'
import { Icon } from './Icon'

type SavedProfile = Omit<PostgresConnectionInput, 'password'> & { id: string; name: string }
const PROFILE_KEY = 'whx.database.postgres-profiles'
const DEFAULT_CONNECTION: PostgresConnectionInput = { host: '127.0.0.1', port: 5432, database: 'postgres', user: 'postgres', password: '', sslmode: 'disable' }

export function DatabaseExplorerPanel({ onError }: { onError: (message: string) => void }) {
  const [profiles, setProfiles] = useState<SavedProfile[]>(loadProfiles)
  const [profileName, setProfileName] = useState('PostgreSQL local')
  const [connection, setConnection] = useState<PostgresConnectionInput>(DEFAULT_CONNECTION)
  const [catalog, setCatalog] = useState<PostgresCatalog>()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [sql, setSQL] = useState('SELECT now();')
  const [readOnly, setReadOnly] = useState(true)
  const [result, setResult] = useState<PostgresQueryResult>()
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const grouped = useMemo(() => groupTables(catalog), [catalog])
  const update = <K extends keyof PostgresConnectionInput>(key: K, value: PostgresConnectionInput[K]) => setConnection((current) => ({ ...current, [key]: value }))

  async function test() { await run(async () => { await api.testPostgres(connection); setStatus('Ligação PostgreSQL validada.') }) }
  async function inspect() { await run(async () => { const next = await api.postgresCatalog(connection); setCatalog(next); setStatus(`${next.tables.length} tabela(s)/view(s) carregadas de ${next.database}.`) }) }
  async function execute() {
    if (!readOnly) {
      const ok = await confirmDialog({ title: 'Executar SQL com escrita?', message: 'O modo de escrita pode alterar ou eliminar dados no PostgreSQL selecionado. Confirme apenas se reviu o comando.', tone: 'warning', confirmLabel: 'Executar SQL' })
      if (!ok) return
    }
    await run(async () => { const next = await api.queryPostgres(connection, sql, readOnly); setResult(next); setStatus(`${next.row_count} linha(s) · ${next.duration_ms} ms${next.truncated ? ' · resultado truncado' : ''}`) })
  }
  async function run(action: () => Promise<void>) { setBusy(true); setStatus(''); try { await action() } catch (error) { onError(messageOf(error)) } finally { setBusy(false) } }

  function saveProfile() {
    const next: SavedProfile = { id: crypto.randomUUID(), name: profileName.trim() || 'PostgreSQL', host: connection.host, port: connection.port, database: connection.database, user: connection.user, sslmode: connection.sslmode }
    const merged = [...profiles.filter((item) => item.name !== next.name), next]
    setProfiles(merged); persistProfiles(merged); setStatus('Perfil guardado sem password.')
  }
  function loadProfile(profile: SavedProfile) { setProfileName(profile.name); setConnection({ host: profile.host, port: profile.port, database: profile.database, user: profile.user, password: '', sslmode: profile.sslmode }); setCatalog(undefined); setResult(undefined); setStatus('Perfil carregado. Introduza a password para ligar.') }
  function deleteProfile(id: string) { const next = profiles.filter((item) => item.id !== id); setProfiles(next); persistProfiles(next) }

  return <section className="right-tool-panel database-explorer-panel">
    <header className="right-tool-heading"><div><span>Database connection · fase 1</span><strong>PostgreSQL</strong></div><span className="database-provider-badge"><Icon name="database" size={13}/> pg</span></header>
    <div className="database-profile-strip">{profiles.map((profile) => <div key={profile.id}><button type="button" onClick={() => loadProfile(profile)}><strong>{profile.name}</strong><small>{profile.user}@{profile.host}:{profile.port}/{profile.database}</small></button><button type="button" onClick={() => deleteProfile(profile.id)} aria-label={`Eliminar ${profile.name}`}><Icon name="close" size={10}/></button></div>)}{!profiles.length && <span>Perfis guardados aparecem aqui; passwords nunca são persistidas.</span>}</div>
    <div className="database-connection-form">
      <label className="wide"><span>Nome do perfil</span><input value={profileName} onChange={(event) => setProfileName(event.target.value)}/></label>
      <label><span>Host</span><input value={connection.host} onChange={(event) => update('host', event.target.value)}/></label>
      <label><span>Porta</span><input type="number" min={1} max={65535} value={connection.port} onChange={(event) => update('port', Number(event.target.value) || 5432)}/></label>
      <label><span>Database</span><input value={connection.database} onChange={(event) => update('database', event.target.value)}/></label>
      <label><span>Utilizador</span><input value={connection.user} onChange={(event) => update('user', event.target.value)}/></label>
      <label><span>Password</span><input type="password" value={connection.password} onChange={(event) => update('password', event.target.value)} autoComplete="new-password"/></label>
      <label><span>SSL mode</span><select value={connection.sslmode} onChange={(event) => update('sslmode', event.target.value as PostgresConnectionInput['sslmode'])}><option>disable</option><option>allow</option><option>prefer</option><option>require</option><option>verify-ca</option><option>verify-full</option></select></label>
      <div className="database-connection-actions wide"><button type="button" disabled={busy} onClick={saveProfile}><Icon name="save" size={12}/> Guardar perfil</button><button type="button" disabled={busy} onClick={() => void test()}><Icon name="check" size={12}/> Testar</button><button type="button" disabled={busy} onClick={() => void inspect()}><Icon name="refresh" size={12}/> Explorar</button></div>
    </div>
    {status && <div className="database-status">{status}</div>}
    <div className="database-catalog">{catalog ? <>{[...grouped.entries()].map(([schema, tables]) => <section key={schema}><header><strong>{schema}</strong><span>{tables.length}</span></header>{tables.map((table) => { const key = `${table.schema}.${table.name}`; return <div className="database-table" key={key}><button type="button" onClick={() => setExpanded((current) => ({ ...current, [key]: !current[key] }))}><Icon name={expanded[key] ? 'chevron' : 'chevron-right'} size={10}/><strong>{table.name}</strong><small>{table.type}</small></button>{expanded[key] && <div className="database-columns">{table.columns.map((column) => <span key={column.name}><b>{column.name}</b><em>{column.data_type}{column.nullable ? '' : ' · NOT NULL'}</em></span>)}</div>}</div>})}</section>)}</> : <div className="right-tool-empty compact"><Icon name="database" size={20}/><span>Teste a ligação e clique em Explorar para carregar schemas, tabelas, views e colunas.</span></div>}</div>
    <div className="database-query"><header><strong>SQL console</strong><label><input type="checkbox" checked={readOnly} onChange={(event) => setReadOnly(event.target.checked)}/> Só leitura</label></header><textarea value={sql} onChange={(event) => setSQL(event.target.value)} spellCheck={false}/><button type="button" className="database-run" disabled={busy || !sql.trim()} onClick={() => void execute()}><Icon name="play" size={12}/> Executar</button>{result && <QueryResult result={result}/>}</div>
  </section>
}

function QueryResult({ result }: { result: PostgresQueryResult }) {
  return <div className="database-result"><div>{result.row_count} linha(s){result.truncated ? ' · primeiras 500' : ''}</div>{result.columns.length ? <div className="database-result-scroll"><table><thead><tr>{result.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{result.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, columnIndex) => <td key={columnIndex}>{formatCell(value)}</td>)}</tr>)}</tbody></table></div> : <p>Comando executado sem conjunto de resultados.</p>}</div>
}
function groupTables(catalog?: PostgresCatalog) { const result = new Map<string, PostgresCatalog['tables']>(); for (const table of catalog?.tables || []) { const group = result.get(table.schema) || []; group.push(table); result.set(table.schema, group) } return result }
function formatCell(value: unknown) { if (value === null) return 'NULL'; if (typeof value === 'object') { try { return JSON.stringify(value) } catch { return String(value) } } return String(value) }
function loadProfiles(): SavedProfile[] { try { const parsed = JSON.parse(localStorage.getItem(PROFILE_KEY) || '[]'); return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.name === 'string' && typeof item.host === 'string') : [] } catch { return [] } }
function persistProfiles(items: SavedProfile[]) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(items)) } catch { /* best effort */ } }
function messageOf(error: unknown) { return error instanceof Error ? error.message : String(error) }
