import { type ComponentProps, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import type { OrchestratorOverview, OrchestratorPriority, OrchestratorTask, OrchestratorTaskStatus, Session } from '../../types'
import { Icon } from '../Icon'
import { Status } from './OrchestratorStatus'
import { ChatPanel } from '../ChatPanel'
import { OrchestratorTaskDrawer } from './OrchestratorTaskDrawer'

const statuses: OrchestratorTaskStatus[] = ['PENDING', 'WAITING', 'READY', 'DOING', 'REVIEW', 'FAILED', 'COMPLETE']
type View = 'kanban' | 'table' | 'list' | 'graph'

export function OrchestratorTasks({ session, overview, chatProps, selectedTask, busy, onSelectedTask, onRun }: {
  session: Session
  overview: OrchestratorOverview
  chatProps?: ComponentProps<typeof ChatPanel>
  selectedTask?: OrchestratorTask
  busy: boolean
  onSelectedTask: (task?: OrchestratorTask) => void
  onRun: <T>(action: () => Promise<T>, after?: (value: T) => void) => Promise<T | undefined>
}) {
  const [view, setView] = useState<View>('kanban')
  const [search, setSearch] = useState('')
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [dragTask, setDragTask] = useState<string>()
  const tasks = useMemo(() => overview.tasks.filter((task) => !search.trim() || `${task.title} ${task.description || ''}`.toLowerCase().includes(search.trim().toLowerCase())), [overview.tasks, search])

  async function move(task: OrchestratorTask, target: OrchestratorTaskStatus) {
    if (task.status === target || task.status === 'DOING' || target === 'DOING' || target === 'REVIEW' || target === 'FAILED') return
    await onRun(() => api.transitionOrchestratorTask(session.id, task.id, target), onSelectedTask)
  }

  return <div className="orchestrator-tasks-page">
    <header className="orchestrator-tasks-toolbar">
      <div><strong>Tasks</strong><span>{overview.tasks.length} no projeto · {overview.tasks.filter((task) => task.status === 'DOING').length} em execução</span></div>
      <label className="orchestrator-search"><Icon name="search" size={14}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar tasks" /></label>
      <div className="orchestrator-view-switch" role="group" aria-label="Vista de tasks">
        {(['kanban', 'table', 'list', 'graph'] as View[]).map((item) => <button key={item} className={view === item ? 'active' : ''} onClick={() => setView(item)}>{item === 'kanban' ? 'Kanban' : item === 'table' ? 'Tabela' : item === 'list' ? 'Lista' : 'Grafo'}</button>)}
      </div>
      <button className="primary" type="button" onClick={() => setNewTaskOpen(true)}><Icon name="plus" size={14}/> Nova Task</button>
    </header>

    <div className={`orchestrator-task-surface view-${view}`}>
      {view === 'kanban' && <Kanban tasks={tasks.filter((task) => task.status !== 'ARCHIVED')} dragTask={dragTask} onDrag={setDragTask} onDrop={(status) => {
        const task = tasks.find((item) => item.id === dragTask); setDragTask(undefined); if (task) void move(task, status)
      }} onSelect={onSelectedTask} />}
      {view === 'table' && <TaskTable tasks={tasks} onSelect={onSelectedTask} />}
      {view === 'list' && <TaskList tasks={tasks} onSelect={onSelectedTask} />}
      {view === 'graph' && <TaskGraph tasks={tasks} onSelect={onSelectedTask} />}
    </div>

    {newTaskOpen && <NewTaskDrawer session={session} overview={overview} busy={busy} onClose={() => setNewTaskOpen(false)} onRun={onRun} />}
    {selectedTask && <OrchestratorTaskDrawer session={session} task={overview.tasks.find((item) => item.id === selectedTask.id) || selectedTask} tasks={overview.tasks} chatProps={chatProps} busy={busy} onClose={() => onSelectedTask(undefined)} onMove={move} onRun={onRun} onSelectedTask={onSelectedTask} />}
  </div>
}

function Kanban({ tasks, dragTask, onDrag, onDrop, onSelect }: { tasks: OrchestratorTask[]; dragTask?: string; onDrag: (id?: string) => void; onDrop: (status: OrchestratorTaskStatus) => void; onSelect: (task: OrchestratorTask) => void }) {
  return <div className="orchestrator-kanban">
    {statuses.map((status) => {
      const grouped = tasks.filter((task) => task.status === status)
      return <section key={status} onDragOver={(event) => { if (status === 'PENDING' || status === 'WAITING' || status === 'READY') event.preventDefault() }} onDrop={() => { if (status === 'PENDING' || status === 'WAITING' || status === 'READY') onDrop(status) }}>
        <header><Status status={status}/><span>{grouped.length}</span></header>
        <div className="orchestrator-kanban-stack">
          {grouped.map((task) => <article key={task.id} draggable={task.status !== 'DOING'} className={dragTask === task.id ? 'dragging' : ''} onDragStart={() => onDrag(task.id)} onDragEnd={() => onDrag(undefined)} onClick={() => onSelect(task)}>
            <div><span className={`priority priority-${task.priority}`}>{task.priority}</span>{task.parallelizable && <span className="parallel">parallel</span>}</div>
            <strong>{task.title}</strong>
            <p>{task.description || 'Sem descrição adicional.'}</p>
            <footer><span>{task.depends_on?.length || 0} deps</span><span>{task.capability || task.complexity || 'task'}</span></footer>
          </article>)}
          {!grouped.length && <div className="orchestrator-column-empty">Arraste uma task para aqui</div>}
        </div>
      </section>
    })}
  </div>
}

function TaskTable({ tasks, onSelect }: { tasks: OrchestratorTask[]; onSelect: (task: OrchestratorTask) => void }) {
  return <div className="orchestrator-table-wrap"><table className="orchestrator-table"><thead><tr><th>Task</th><th>Status</th><th>Condição</th><th>Prioridade</th><th>Dependências</th><th>Atualizada</th></tr></thead><tbody>
    {tasks.map((task) => <tr key={task.id} onClick={() => onSelect(task)}><td><strong>{task.title}</strong><small>{task.plan_id ? 'Plano' : 'Manual'} · {task.id}</small></td><td><Status status={task.status}/></td><td>{task.condition === 'none' ? '—' : task.condition.replaceAll('_', ' ')}</td><td>{task.priority}</td><td>{task.depends_on?.length || 0}</td><td>{formatDate(task.updated_at)}</td></tr>)}
  </tbody></table>{!tasks.length && <div className="orchestrator-empty">Nenhuma task corresponde ao filtro.</div>}</div>
}

function TaskList({ tasks, onSelect }: { tasks: OrchestratorTask[]; onSelect: (task: OrchestratorTask) => void }) {
  return <div className="orchestrator-list">{tasks.map((task) => <button key={task.id} onClick={() => onSelect(task)}><Status status={task.status}/><span><strong>{task.title}</strong><small>{task.description || 'Sem descrição'} · {task.depends_on?.length || 0} dependência(s)</small></span><span className={`priority priority-${task.priority}`}>{task.priority}</span><Icon name="chevron-right" size={14}/></button>)}{!tasks.length && <div className="orchestrator-empty">Nenhuma task corresponde ao filtro.</div>}</div>
}

function TaskGraph({ tasks, onSelect }: { tasks: OrchestratorTask[]; onSelect: (task: OrchestratorTask) => void }) {
  const levels = graphLevels(tasks)
  return <div className="orchestrator-graph">
    {levels.map((level, index) => <section key={index}><header>Camada {index + 1}</header><div>{level.map((task) => <button key={task.id} onClick={() => onSelect(task)}><Status status={task.status}/><strong>{task.title}</strong><small>{task.depends_on?.length ? `← ${task.depends_on.length} dependência(s)` : 'Ponto de entrada'}</small></button>)}</div>{index < levels.length - 1 && <span className="graph-arrow">↓</span>}</section>)}
    {!tasks.length && <div className="orchestrator-empty">Nenhuma task para representar no grafo.</div>}
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
    <header><div><span>Task manual</span><strong>Nova Task</strong></div><button onClick={onClose} aria-label="Fechar"><Icon name="close" size={16}/></button></header>
    <div className="orchestrator-form">
      <label>Título<input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus /></label>
      <label>Descrição<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5}/></label>
      <div className="orchestrator-form-row"><label>Plano<select value={planID} onChange={(event) => { setPlanID(event.target.value); setDependencies([]) }}><option value="">Sem plano</option>{overview.plans.filter((plan) => plan.status !== 'ARCHIVED').map((plan) => <option key={plan.id} value={plan.id}>{plan.title}</option>)}</select></label><label>Prioridade<select value={priority} onChange={(event) => setPriority(event.target.value as OrchestratorPriority)}><option value="low">low</option><option value="normal">normal</option><option value="high">high</option><option value="urgent">urgent</option></select></label></div>
      <fieldset><legend>Dependências</legend>{overview.tasks.filter((task) => !planID || task.plan_id === planID).filter((task) => task.status !== 'ARCHIVED').map((task) => <label key={task.id} className="orchestrator-check"><input type="checkbox" checked={dependencies.includes(task.id)} onChange={(event) => setDependencies((current) => event.target.checked ? [...current, task.id] : current.filter((id) => id !== task.id))}/><span>{task.title}</span><Status status={task.status}/></label>)}</fieldset>
    </div>
    <footer><button onClick={onClose}>Cancelar</button><button className="primary" disabled={busy || !title.trim()} onClick={() => void create()}>Criar Task</button></footer>
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
