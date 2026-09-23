import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { AppConfig, KnowledgeCatalog, PanelName, PostgresConnection, PostgresQueryResult, ProjectConfig, ProjectTodo, Session, WorkspaceChat } from '../types'

const panels: Array<[PanelName, string, string]> = [
  ['notifications', 'Atenção', 'Sinais que precisam de intervenção'], ['archive', 'Arquivo', 'Chats arquivados deste projeto'], ['todos', 'TODO', 'Trabalho persistente do projeto'],
  ['project', 'Projeto', 'Configuração e contexto'], ['library', 'Biblioteca', 'Artefactos duráveis'], ['knowledge', 'Conhecimento', 'Aprendizagem consolidada'],
  ['git', 'Git', 'Estado do repositório'], ['agents', 'Agentes', 'Supervisor, Workers e fila'], ['tasks', 'Tarefas', 'Ledger unificado'],
  ['errors', 'Erros', 'Ocorrências estruturadas'], ['evolution', 'Evolução', 'Evidência operacional'], ['database', 'Base de dados', 'PostgreSQL remoto'],
  ['docker', 'Docker', 'Serviços do projeto'], ['files', 'Ficheiros', 'Árvore do projeto'], ['artifacts', 'Artefactos', 'Resultados da sessão'], ['tunnels', 'Túneis', 'Entrada remota segura'],
]
const rows = (value: unknown) => Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : []
const text = (value: unknown) => value == null ? '' : String(value)
const object = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

export function PanelDrawer({ panel, project, session, chats, config, onPanel, onClose, onConfig, onOpenChat, onError }: {
  panel: PanelName; project: string; session?: Session; chats: WorkspaceChat[]; config?: AppConfig; onPanel: (panel: PanelName) => void; onClose: () => void
  onConfig: (config: AppConfig) => void; onOpenChat: (chat: WorkspaceChat) => void; onError: (message: string) => void
}) {
  const [data, setData] = useState<unknown>()
  const [loading, setLoading] = useState(false)
  const [projectConfig, setProjectConfig] = useState<ProjectConfig>()
  const [connection, setConnection] = useState<PostgresConnection>({ host: '127.0.0.1', port: 5432, database: 'postgres', user: 'postgres', password: '', sslmode: 'disable' })
  const [sql, setSQL] = useState('SELECT now();')
  const [readOnly, setReadOnly] = useState(true)
  const [queryResult, setQueryResult] = useState<PostgresQueryResult>()
  const [databaseStatus, setDatabaseStatus] = useState('')

  const load = useCallback(async () => {
    if (panel === 'tunnels') { setData(config); return }
    if (panel === 'archive') { setData({ chats: chats.filter((item) => item.archived_at) }); return }
    if (!session) { setData(undefined); return }
    setLoading(true)
    try {
      let next: unknown
      if (panel === 'notifications') next = await api.attention(project)
      else if (panel === 'tasks') next = await api.tasks(project)
      else if (panel === 'todos') next = await api.todos(session.id)
      else if (panel === 'files') next = await api.files(session.id)
      else if (panel === 'artifacts') next = await api.artifacts(session.id)
      else if (panel === 'library') next = await api.managedArtifacts('', 'library')
      else if (panel === 'knowledge') next = await api.knowledge(session.id)
      else if (panel === 'project') { const value = await api.projectConfig(session.id); setProjectConfig(value); next = value }
      else if (panel === 'git') next = await api.git(session.id)
      else if (panel === 'agents') next = { provider: await api.agentProvider(), queue: await api.agentQueue(project) }
      else if (panel === 'errors') next = await api.executionErrors(session.id)
      else if (panel === 'evolution') next = await api.evolutionEvidence(session.id)
      else if (panel === 'docker') next = await api.docker(session.id)
      else next = undefined
      setData(next)
    } catch (error) { onError(error instanceof Error ? error.message : String(error)) } finally { setLoading(false) }
  }, [chats, config, onError, panel, project, session])
  useEffect(() => { void load() }, [load])

  async function toggleTodo(todo: ProjectTodo) {
    if (!session) return
    try { await api.updateTodo(session.id, todo.id, todo.status === 'done' ? 'open' : 'done'); await load() }
    catch (error) { onError(error instanceof Error ? error.message : String(error)) }
  }
  async function tunnelAction(id: string, action: 'pause' | 'stop' | 'resume') {
    try { const result = await api.controlTunnel(id, action); onConfig({ ...config, remote_input: result.remote_input }); await load() }
    catch (error) { onError(error instanceof Error ? error.message : String(error)) }
  }
  async function saveProjectConfig(next: ProjectConfig) {
    if (!session) return
    try { const result = await api.updateProjectConfig(session.id, next); setProjectConfig(result.config); setData(result.config) }
    catch (error) { onError(error instanceof Error ? error.message : String(error)) }
  }
  async function database(action: 'test' | 'catalog' | 'query') {
    setLoading(true); setDatabaseStatus('')
    try {
      if (action === 'test') { await api.postgresTest(connection); setDatabaseStatus('Ligação PostgreSQL validada.') }
      if (action === 'catalog') { const value = await api.postgresCatalog(connection); setData(value); setDatabaseStatus(`${value.tables.length} objeto(s) carregado(s).`) }
      if (action === 'query') { const value = await api.postgresQuery(connection, sql, readOnly); setQueryResult(value); setDatabaseStatus(`${value.row_count} linha(s) · ${value.duration_ms} ms`) }
    } catch (error) { onError(error instanceof Error ? error.message : String(error)) } finally { setLoading(false) }
  }

  const record = object(data)
  const list = panel === 'notifications' ? rows(record.records) : panel === 'tasks' ? rows(record.tasks) : panel === 'todos' ? rows(record.todos) : panel === 'files' ? rows(record.files) : panel === 'artifacts' ? rows(record.artifacts) : panel === 'archive' ? rows(record.chats) : panel === 'errors' ? rows(record.errors) : panel === 'evolution' ? rows(record.events) : []
  const containers = panel === 'docker' ? rows(record.containers) : []
  const panelInfo = panels.find(([id]) => id === panel)

  return <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-lg flex-col border-l border-slate-800 bg-slate-950 shadow-2xl shadow-black/50 sm:w-[32rem]">
    <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-400">Painéis do Desktop · remoto</p><h2 className="mt-1 text-sm font-semibold">{panelInfo?.[1]}</h2><p className="mt-0.5 text-[11px] text-slate-600">{panelInfo?.[2]}</p></div><button onClick={onClose} className="grid size-9 place-items-center rounded-xl border border-slate-800 text-slate-400 hover:bg-slate-900" aria-label="Fechar painel">×</button></header>
    <nav className="flex gap-1 overflow-x-auto border-b border-slate-800 p-2">{panels.map(([id, label]) => <button key={id} onClick={() => onPanel(id)} className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${id === panel ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'}`}>{label}</button>)}</nav>
    <div className="min-h-0 flex-1 overflow-y-auto p-4">{loading ? <p className="text-sm text-slate-500">A carregar…</p> : <PanelBody/>}</div>
  </aside>

  function PanelBody() {
    if (panel === 'database') return <DatabasePanel/>
    if (panel === 'tunnels') return <div className="space-y-3">{(config?.remote_input?.instances || []).map((item) => <article key={item.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3"><div className="flex justify-between gap-2"><div><p className="font-semibold">{item.id}</p><p className="mt-1 text-xs text-slate-500">{item.provider} · {item.state || (item.available ? 'active' : 'unavailable')}</p></div><span className="text-xs text-slate-600">{item.usage.requests_in_window} req</span></div>{item.public_url && <p className="mt-2 truncate rounded-lg bg-slate-950 px-2 py-1.5 font-mono text-[11px] text-cyan-300">{item.public_url}</p>}<div className="mt-3 flex gap-2">{(item.state || 'active') === 'active' ? <Tiny onClick={() => void tunnelAction(item.id, 'pause')}>Pausar</Tiny> : <Tiny onClick={() => void tunnelAction(item.id, 'resume')}>Retomar</Tiny>}<Tiny onClick={() => void api.testTunnel(item.id).then(load).catch((error) => onError(String(error)))}>Testar</Tiny><Tiny danger onClick={() => void tunnelAction(item.id, 'stop')}>Parar</Tiny></div></article>)}<Empty when={!config?.remote_input?.instances?.length}/></div>
    if (panel === 'archive') return <div className="space-y-2">{list.map((item) => { const archived = item as unknown as WorkspaceChat; return <button key={archived.id} onClick={() => onOpenChat(archived)} className="block w-full rounded-xl border border-slate-800 bg-slate-900 p-3 text-left hover:border-slate-700"><p className="text-sm font-semibold">{archived.title || 'Chat arquivado'}</p><p className="mt-1 text-[11px] text-slate-500">{archived.archived_at ? new Date(archived.archived_at).toLocaleString() : archived.session_id}</p></button> })}<Empty when={!list.length}/></div>
    if (panel === 'todos') return <div className="space-y-2">{list.map((item) => { const todo = item as unknown as ProjectTodo; return <article key={todo.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3"><div className="flex gap-3"><button onClick={() => void toggleTodo(todo)} className={`mt-0.5 size-5 shrink-0 rounded-md border ${todo.status === 'done' ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300' : 'border-slate-600'}`}>{todo.status === 'done' ? '✓' : ''}</button><div><p className={`text-sm ${todo.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-200'}`}>{todo.body}</p><p className="mt-1 text-[11px] text-slate-600">{todo.kind || 'TODO'} · {todo.execution_status || todo.classification_status || 'open'}</p></div></div></article>})}<Empty when={!list.length}/></div>
    if (panel === 'project') return projectConfig ? <div className="space-y-3"><label className="block text-xs text-slate-500">Nome do projeto<input value={projectConfig.project.name} onChange={(event) => setProjectConfig({ ...projectConfig, project: { name: event.target.value } })} className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-600"/></label><label className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 p-3 text-sm"><span><b className="block">Auto-excluir ficheiros</b><small className="text-slate-500">Segue a mesma política de contexto do Desktop.</small></span><input type="checkbox" checked={projectConfig.context.auto_exclude} onChange={(event) => setProjectConfig({ ...projectConfig, context: { ...projectConfig.context, auto_exclude: event.target.checked } })}/></label><Card title="Include" value={projectConfig.context.include.join(', ') || '—'}/><Card title="Exclude" value={projectConfig.context.exclude.join(', ') || '—'}/><button onClick={() => void saveProjectConfig(projectConfig)} className="w-full rounded-xl bg-cyan-400 px-3 py-2 text-xs font-bold text-slate-950">Guardar configuração</button></div> : <Empty when/>
    if (panel === 'library') { const managed = rows(record.artifacts); return <div className="space-y-2">{managed.map((item, index) => { const artifact = object(item.artifact); return <Row key={text(artifact.id || artifact.artifact_id || index)} title={text(artifact.name || artifact.filename || 'Artefacto')} meta={`${text(item.project_path)} · ${text(artifact.kind || artifact.request_id)}`}/> })}<Empty when={!managed.length}/></div> }
    if (panel === 'knowledge') { const catalog = object(record.catalog) as unknown as KnowledgeCatalog; return <div className="space-y-3"><div className="grid grid-cols-2 gap-2"><Card title="Revisão" value={text(catalog?.revision ?? '—')}/><Card title="Entradas" value={text(catalog?.entries?.length ?? 0)}/></div>{(catalog?.entries || []).map((entry) => <article key={entry.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3"><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold text-cyan-300">{entry.id}</p><span className="text-[10px] text-slate-600">v{entry.version}</span></div><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-300">{entry.content}</p></article>)}<Empty when={!catalog?.entries?.length}/></div> }
    if (panel === 'agents') { const provider = object(record.provider); const queue = object(record.queue); return <div className="space-y-3"><div className="grid grid-cols-2 gap-2"><Card title="Provider" value={`${text(provider.provider || 'chatgpt')}${provider.paused ? ' · pausado' : ' · ativo'}`}/><Card title="Fila" value={`${text(queue.due || 0)} pronta · ${text(queue.queued || 0)} total`}/><Card title="Supervisor lanes" value={text(queue.due_supervisor_lanes || 0)}/><Card title="Workers" value={text(queue.due_worker || 0)}/></div>{Boolean(provider.reason) && <Row title="Provider guard" meta={text(provider.reason)}/>}<p className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs leading-5 text-slate-500">O webapp observa o pool durável. A escrita/leitura do navegador continua exclusivamente nos Supervisors e Workers do Desktop.</p></div> }
    if (panel === 'git') { const working = object(record.working); const head = object(record.head); return <div className="space-y-3"><Card title="Branch" value={text(head.branch || record.branch || '—')}/><Card title="Working tree" value={working.clean === true ? 'Limpa' : `${text(working.stageable_count || rows(working.files).length)} alteração(ões)`}/>{rows(working.files).slice(0, 40).map((file) => <Row key={text(file.path)} title={text(file.path)} meta={text(file.status || file.kind)}/>)}</div> }
    if (panel === 'docker') return <div className="space-y-2">{containers.map((item) => <article key={text(item.id || item.name)} className="rounded-xl border border-slate-800 bg-slate-900 p-3"><div className="flex justify-between gap-2"><div><p className="text-sm font-semibold">{text(item.name || item.id)}</p><p className="mt-1 text-xs text-slate-500">{text(item.status || item.state)}</p></div>{session && <div className="flex gap-1"><Tiny onClick={() => void api.dockerAction(session.id, text(item.id), 'start').then(load).catch((error) => onError(String(error)))}>Start</Tiny><Tiny onClick={() => void api.dockerAction(session.id, text(item.id), 'restart').then(load).catch((error) => onError(String(error)))}>Restart</Tiny><Tiny danger onClick={() => void api.dockerAction(session.id, text(item.id), 'stop').then(load).catch((error) => onError(String(error)))}>Stop</Tiny></div>}</div></article>)}<Empty when={!containers.length}/></div>
    if (panel === 'errors') return <div className="space-y-2">{list.map((item) => <article key={text(item.id)} className={`rounded-xl border p-3 ${item.status === 'resolved' ? 'border-slate-800 bg-slate-900' : 'border-rose-900/60 bg-rose-950/20'}`}><div className="flex justify-between gap-2"><p className="text-sm font-semibold">{text(item.error || 'Falha de execução')}</p><span className="text-[10px] uppercase text-slate-500">{text(item.status)}</span></div><p className="mt-1 text-xs text-slate-500">{text(item.failure_kind || item.stage || item.request_id)}</p>{Boolean(item.cause) && <p className="mt-2 text-xs leading-5 text-slate-400">{text(item.cause)}</p>}</article>)}<Empty when={!list.length}/></div>
    if (panel === 'evolution') return <div className="space-y-2"><div className="grid grid-cols-2 gap-2"><Card title="Evidências" value={text(record.total || list.length)}/><Card title="Categorias" value={text(rows(record.categories).length || (Array.isArray(record.categories) ? record.categories.length : 0))}/></div>{list.slice().reverse().slice(0, 60).map((item) => <Row key={text(item.id)} title={`${text(item.category || 'evidência')} · ${text(item.type)}`} meta={`${text(item.project_name || item.project_path)} · ${text(item.timestamp)}`}/>)}<Empty when={!list.length}/></div>
    return <div className="space-y-2">{list.slice(0, 100).map((item, index) => <Row key={text(item.id || item.task_id || item.path || index)} title={text(item.title || item.body || item.name || item.filename || item.path || item.type || 'Item')} meta={text(item.status || item.state || item.kind || item.last_error || item.request_id)}/>) }<Empty when={!list.length}/></div>
  }

  function DatabasePanel() {
    const catalog = panel === 'database' ? record : {}
    const tables = rows(catalog.tables)
    return <div className="space-y-3"><div className="grid grid-cols-2 gap-2"><Field label="Host" value={connection.host} onChange={(value) => setConnection({ ...connection, host: value })}/><Field label="Porta" value={String(connection.port)} onChange={(value) => setConnection({ ...connection, port: Number(value) || 5432 })}/><Field label="Database" value={connection.database} onChange={(value) => setConnection({ ...connection, database: value })}/><Field label="Utilizador" value={connection.user} onChange={(value) => setConnection({ ...connection, user: value })}/></div><label className="block text-xs text-slate-500">Password<input type="password" value={connection.password} onChange={(event) => setConnection({ ...connection, password: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-600"/></label><div className="flex gap-2"><Tiny onClick={() => void database('test')}>Testar</Tiny><Tiny onClick={() => void database('catalog')}>Catálogo</Tiny></div>{databaseStatus && <p className="rounded-lg bg-slate-900 px-3 py-2 text-xs text-emerald-300">{databaseStatus}</p>}{tables.length > 0 && <div className="max-h-48 space-y-1 overflow-auto rounded-xl border border-slate-800 p-2">{tables.map((table) => <Row key={`${text(table.schema)}.${text(table.name)}`} title={`${text(table.schema)}.${text(table.name)}`} meta={`${text(table.type)} · ${rows(table.columns).length} coluna(s)`}/>)}</div>}<textarea value={sql} onChange={(event) => setSQL(event.target.value)} rows={5} spellCheck={false} className="w-full rounded-xl border border-slate-800 bg-slate-900 p-3 font-mono text-xs outline-none focus:border-cyan-600"/><div className="flex items-center gap-2"><label className="flex items-center gap-1.5 text-xs text-slate-500"><input type="checkbox" checked={readOnly} onChange={(event) => setReadOnly(event.target.checked)}/>Só leitura</label><button disabled={!sql.trim()} onClick={() => void database('query')} className="ml-auto rounded-lg bg-cyan-400 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-40">Executar SQL</button></div>{queryResult && <div className="overflow-auto rounded-xl border border-slate-800"><table className="min-w-full text-left text-[11px]"><thead className="bg-slate-900 text-slate-500"><tr>{queryResult.columns.map((column) => <th key={column} className="px-2 py-1.5">{column}</th>)}</tr></thead><tbody>{queryResult.rows.slice(0, 100).map((row, index) => <tr key={index} className="border-t border-slate-800">{row.map((value, cell) => <td key={cell} className="max-w-64 truncate px-2 py-1.5">{text(value)}</td>)}</tr>)}</tbody></table></div>}</div>
  }
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="block text-xs text-slate-500">{label}<input value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-600"/></label> }
function Row({ title, meta }: { title: string; meta: string }) { return <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><p className="break-words text-sm font-medium">{title}</p>{meta && <p className="mt-1 break-words text-[11px] text-slate-500">{meta}</p>}</div> }
function Card({ title, value }: { title: string; value: string }) { return <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-600">{title}</p><p className="mt-1 text-sm font-semibold">{value}</p></div> }
function Empty({ when }: { when: boolean }) { return when ? <p className="rounded-xl border border-dashed border-slate-800 px-4 py-8 text-center text-xs text-slate-600">Sem dados para este painel.</p> : null }
function Tiny({ children, danger = false, onClick }: { children: string; danger?: boolean; onClick: () => void }) { return <button onClick={onClick} className={`rounded-lg border px-2 py-1 text-[11px] ${danger ? 'border-rose-900 text-rose-300' : 'border-slate-700 text-slate-300'}`}>{children}</button> }
