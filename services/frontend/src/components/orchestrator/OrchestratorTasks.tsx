import { type ComponentProps, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { canonicalTaskDirective } from '../../lib/composerTaskDirectives'
import { combineOrchestratorTasks, mergeOrchestratorTaskPages } from '../../lib/orchestratorApi'
import { ORCHESTRATOR_TERMINAL_STATUSES, type EffortLevel, type OrchestratorOverview, type OrchestratorPriority, type OrchestratorTask, type OrchestratorTaskPage, type OrchestratorTaskPageQuery, type OrchestratorTaskStatus, type OrchestratorTerminalTaskPages, type OrchestratorTerminalTaskStatus, type Session } from '../../types'
import { Icon } from '../Icon'
import { Status } from './OrchestratorStatus'
import { ChatPanel } from '../ChatPanel'
import { OrchestratorKanban } from './OrchestratorKanban'
import { OrchestratorTaskDrawer } from './OrchestratorTaskDrawer'

type View = 'kanban' | 'table' | 'list' | 'graph'
type TerminalQuery = Omit<OrchestratorTaskPageQuery, 'status' | 'limit'>

export function OrchestratorTasks({ session, overview, terminalPages = {}, chatProps, selectedTask, busy, onSelectedTask, onLoadTerminalPage, onRun }: {
  session: Session
  overview: OrchestratorOverview
  terminalPages?: OrchestratorTerminalTaskPages
  chatProps?: ComponentProps<typeof ChatPanel>
  selectedTask?: OrchestratorTask
  busy: boolean
  onSelectedTask: (task?: OrchestratorTask) => void
  onLoadTerminalPage?: (status: OrchestratorTerminalTaskStatus, query?: TerminalQuery) => Promise<OrchestratorTaskPage | undefined>
  onRun: <T>(action: () => Promise<T>, after?: (value: T) => void) => Promise<T | undefined>
}) {
  const [view, setView] = useState<View>('kanban')
  const [search, setSearch] = useState('')
  const [searchPages, setSearchPages] = useState<OrchestratorTerminalTaskPages>({})
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [dragTask, setDragTask] = useState<string>()
  const [loadingStatus, setLoadingStatus] = useState<OrchestratorTerminalTaskStatus>()
  const searchVersion = useRef(0)
  const query = search.trim()
  const loadedTasks = useMemo(() => combineOrchestratorTasks(overview.tasks, terminalPages), [overview.tasks, terminalPages])

  useEffect(() => {
    const version = ++searchVersion.current
    if (!query || !onLoadTerminalPage) { setSearchPages({}); return }
    setSearchPages({})
    const timer = window.setTimeout(() => {
      ORCHESTRATOR_TERMINAL_STATUSES.forEach((status) => {
        void onLoadTerminalPage(status, { q: query }).then((page) => {
          if (!page || searchVersion.current !== version) return
          setSearchPages((current) => ({ ...current, [status]: page }))
        })
      })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [onLoadTerminalPage, query])

  const displayPages = query && onLoadTerminalPage ? searchPages : terminalPages
  const tasks = useMemo(() => {
    const needle = query.toLowerCase()
    const result = new Map<string, OrchestratorTask>()
    overview.tasks.forEach((task) => {
      if (!needle || `${task.title} ${task.description || ''}`.toLowerCase().includes(needle)) result.set(task.id, task)
    })
    ORCHESTRATOR_TERMINAL_STATUSES.forEach((status) => displayPages[status]?.tasks.forEach((task) => {
      if (query && !onLoadTerminalPage && !`${task.title} ${task.description || ''}`.toLowerCase().includes(needle)) return
      result.set(task.id, task)
    }))
    return [...result.values()]
  }, [displayPages, onLoadTerminalPage, overview.tasks, query])

  async function move(task: OrchestratorTask, target: OrchestratorTaskStatus) {
    if (task.status === target || task.status === 'DOING' || target === 'DOING' || target === 'REVIEW' || target === 'FAILED') return
    await onRun(() => api.transitionOrchestratorTask(session.id, task.id, target), onSelectedTask)
  }

  function changeEffort(task: OrchestratorTask, level: EffortLevel) {
    void onRun(() => api.setOrchestratorTaskEffortLevel(session.id, task.id, level))
  }

  async function loadMore(status: OrchestratorTerminalTaskStatus) {
    const page = displayPages[status]
    if (!onLoadTerminalPage || !page?.has_more || !page.next_cursor) return
    setLoadingStatus(status)
    try {
      const next = await onLoadTerminalPage(status, { q: query || undefined, cursor: page.next_cursor })
      if (query && next) setSearchPages((current) => ({ ...current, [status]: mergeOrchestratorTaskPages(current[status], next) }))
    } finally { setLoadingStatus(undefined) }
  }

  const totalTasks = Object.values(overview.task_counts).reduce((total, count) => total + count, 0)
  return <div className="orchestrator-tasks-page">
    <header className="orchestrator-tasks-toolbar">
      <div><strong className="text-lg">Tasks</strong><span className="text-sm text-[var(--theme-text-muted)]">{totalTasks} no projeto · {overview.task_counts.DOING} em execução</span></div>
      <label className="orchestrator-search"><Icon name="search" size={14}/><input className="text-base" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar tasks" /></label>
      <div className="orchestrator-view-switch" role="group" aria-label="Vista de tasks">
        {(['kanban', 'table', 'list', 'graph'] as View[]).map((item) => <button key={item} className={`${view === item ? 'active ' : ''}text-base`} onClick={() => setView(item)}>{item === 'kanban' ? 'Kanban' : item === 'table' ? 'Tabela' : item === 'list' ? 'Lista' : 'Grafo'}</button>)}
      </div>
      <button className="primary text-base font-bold" type="button" onClick={() => setNewTaskOpen(true)}><Icon name="plus" size={14}/> Nova Task</button>
    </header>

    <div className={`orchestrator-task-surface view-${view}`}>
      {view === 'kanban' && <OrchestratorKanban tasks={tasks} taskCounts={overview.task_counts} terminalPages={displayPages} searching={Boolean(query)} session={session} busy={busy} dragTask={dragTask} loadingStatus={loadingStatus} onEffort={changeEffort} onDrag={setDragTask} onDrop={(status) => {
        const task = loadedTasks.find((item) => item.id === dragTask); setDragTask(undefined); if (task) void move(task, status)
      }} onLoadMore={(status) => void loadMore(status)} onSelect={onSelectedTask} onOpenChat={chatProps ? (task) => chatProps.onNewChat(canonicalTaskDirective(task.id)) : undefined} />}
      {view === 'table' && <TaskTable tasks={tasks} onSelect={onSelectedTask} />}
      {view === 'list' && <TaskList tasks={tasks} onSelect={onSelectedTask} />}
      {view === 'graph' && <TaskGraph tasks={tasks} onSelect={onSelectedTask} />}
    </div>

    {newTaskOpen && <NewTaskDrawer session={session} overview={overview} busy={busy} onClose={() => setNewTaskOpen(false)} onRun={onRun} />}
    {selectedTask && <OrchestratorTaskDrawer session={session} task={loadedTasks.find((item) => item.id === selectedTask.id) || selectedTask} tasks={loadedTasks} chatProps={chatProps} busy={busy} onClose={() => onSelectedTask(undefined)} onMove={move} onRun={onRun} onSelectedTask={onSelectedTask} />}
  </div>
}

function TaskTable({ tasks, onSelect }: { tasks: OrchestratorTask[]; onSelect: (task: OrchestratorTask) => void }) {
  return <div className="orchestrator-table-wrap"><table className="orchestrator-table"><thead className="text-base font-semibold"><tr><th>Task</th><th>Status</th><th>Condição</th><th>Prioridade</th><th>Dependências</th><th>Atualizada</th></tr></thead><tbody className="text-sm">
    {tasks.map((task) => <tr key={task.id} onClick={() => onSelect(task)}><td><strong className="text-base">{task.title}</strong><small className="font-mono text-sm leading-[1.3] text-[var(--theme-text-soft)]">{task.plan_id ? 'Plano' : 'Manual'} · {task.id}</small></td><td><Status status={task.status}/></td><td>{task.condition === 'none' ? '—' : task.condition.replaceAll('_', ' ')}</td><td>{task.priority}</td><td>{task.depends_on?.length || 0}</td><td>{formatDate(task.updated_at)}</td></tr>)}
  </tbody></table>{!tasks.length && <div className="orchestrator-empty text-base">Nenhuma task corresponde ao filtro.</div>}</div>
}

function TaskList({ tasks, onSelect }: { tasks: OrchestratorTask[]; onSelect: (task: OrchestratorTask) => void }) {
  return <div className="orchestrator-list">{tasks.map((task) => <button key={task.id} onClick={() => onSelect(task)}><Status status={task.status}/><span><strong className="text-base">{task.title}</strong><small className="text-sm text-[var(--theme-text-muted)]">{task.description || 'Sem descrição'} · {task.depends_on?.length || 0} dependência(s)</small></span><span className={`priority priority-${task.priority} font-mono text-sm leading-[1.4]`}>{task.priority}</span><Icon name="chevron-right" size={14}/></button>)}{!tasks.length && <div className="orchestrator-empty text-base">Nenhuma task corresponde ao filtro.</div>}</div>
}

function TaskGraph({ tasks, onSelect }: { tasks: OrchestratorTask[]; onSelect: (task: OrchestratorTask) => void }) {
  const levels = graphLevels(tasks)
  return <div className="orchestrator-graph">
    {levels.map((level, index) => <section key={index}><header className="mb-2 font-mono text-sm uppercase tracking-[0.08em] text-[var(--theme-text-soft)]">Camada {index + 1}</header><div>{level.map((task) => <button key={task.id} onClick={() => onSelect(task)}><Status status={task.status}/><strong className="text-base">{task.title}</strong><small className="text-sm text-[var(--theme-text-soft)]">{task.depends_on?.length ? `← ${task.depends_on.length} dependência(s)` : 'Ponto de entrada'}</small></button>)}</div>{index < levels.length - 1 && <span className="graph-arrow text-lg">↓</span>}</section>)}
    {!tasks.length && <div className="orchestrator-empty text-base">Nenhuma task para representar no grafo.</div>}
  </div>
}

function NewTaskDrawer({ session, overview, busy, onClose, onRun }: { session: Session; overview: OrchestratorOverview; busy: boolean; onClose: () => void; onRun: <T>(action: () => Promise<T>, after?: (value: T) => void) => Promise<T | undefined> }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [planID, setPlanID] = useState('')
  const [priority, setPriority] = useState<OrchestratorPriority>('normal')
  const [dependencies, setDependencies] = useState<string[]>([])
  async function create() {
    if (!title.trim()) return
    const value = await onRun(() => api.createOrchestratorTask(session.id, { plan_id: planID || undefined, title: title.trim(), description: description.trim(), priority, depends_on: dependencies }))
    if (value) onClose()
  }
  return <div className="orchestrator-drawer-backdrop" data-chatgpt-overlay-blocker="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><aside className="orchestrator-drawer">
    <header><div><span className="truncate font-mono text-sm leading-[1.3] text-[var(--theme-text-soft)]">Task manual</span><strong className="truncate text-lg">Nova Task</strong></div><button onClick={onClose} aria-label="Fechar"><Icon name="close" size={16}/></button></header>
    <div className="orchestrator-form">
      <label className="text-sm font-semibold">Título<input className="text-base" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus /></label>
      <label className="text-sm font-semibold">Descrição<textarea className="text-base" value={description} onChange={(event) => setDescription(event.target.value)} rows={5}/></label>
      <div className="orchestrator-form-row"><label className="text-sm font-semibold">Plano<select className="text-base" value={planID} onChange={(event) => { setPlanID(event.target.value); setDependencies([]) }}><option value="">Sem plano</option>{overview.plans.filter((plan) => plan.status !== 'ARCHIVED').map((plan) => <option key={plan.id} value={plan.id}>{plan.title}</option>)}</select></label><label className="text-sm font-semibold">Prioridade<select className="text-base" value={priority} onChange={(event) => setPriority(event.target.value as OrchestratorPriority)}><option value="low">low</option><option value="normal">normal</option><option value="high">high</option><option value="urgent">urgent</option></select></label></div>
      <fieldset><legend className="text-sm">Dependências</legend>{overview.tasks.filter((task) => !planID || task.plan_id === planID).filter((task) => task.status !== 'ARCHIVED').map((task) => <label key={task.id} className="orchestrator-check text-base"><input type="checkbox" checked={dependencies.includes(task.id)} onChange={(event) => setDependencies((current) => event.target.checked ? [...current, task.id] : current.filter((id) => id !== task.id))}/><span>{task.title}</span><Status status={task.status}/></label>)}</fieldset>
    </div>
    <footer><button className="text-base" onClick={onClose}>Cancelar</button><button className="primary text-base font-bold" disabled={busy || !title.trim()} onClick={() => void create()}>Criar Task</button></footer>
  </aside></div>
}

function graphLevels(tasks: OrchestratorTask[]) {
  const remaining = new Map(tasks.map((task) => [task.id, task]))
  const levels: OrchestratorTask[][] = []
  const emitted = new Set<string>()
  while (remaining.size) {
    const level = [...remaining.values()].filter((task) => (task.depends_on || []).every((dependency) => emitted.has(dependency) || !remaining.has(dependency)))
    const safe = level.length ? level : [remaining.values().next().value as OrchestratorTask]
    levels.push(safe)
    safe.forEach((task) => { remaining.delete(task.id); emitted.add(task.id) })
  }
  return levels
}

function formatDate(value: string) {
  try { return new Intl.DateTimeFormat('pt', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) } catch { return value }
}
