import {
  ORCHESTRATOR_TASK_STATUSES,
  ORCHESTRATOR_TERMINAL_STATUSES,
  type OrchestratorOverview,
  type OrchestratorTask,
  type OrchestratorTaskCounts,
  type OrchestratorTaskPage,
  type OrchestratorTaskPageQuery,
  type OrchestratorTaskStatus,
  type OrchestratorTerminalTaskPages,
} from '../types/orchestrator'

type Requester = <T>(path: string, init?: RequestInit) => Promise<T>

function taskStatus(value: unknown): value is OrchestratorTaskStatus {
  return ORCHESTRATOR_TASK_STATUSES.includes(value as OrchestratorTaskStatus)
}

export function isOrchestratorTask(value: unknown): value is OrchestratorTask {
  if (!value || typeof value !== 'object') return false
  const task = value as Partial<OrchestratorTask>
  return typeof task.id === 'string' && taskStatus(task.status)
}

export function emptyOrchestratorTaskCounts(): OrchestratorTaskCounts {
  return Object.fromEntries(ORCHESTRATOR_TASK_STATUSES.map((status) => [status, 0])) as OrchestratorTaskCounts
}

export function normalizeOrchestratorTask(task: OrchestratorTask): OrchestratorTask {
  return {
    ...task,
    depends_on: Array.isArray(task?.depends_on) ? task.depends_on : [],
    allowed_transitions: Array.isArray(task?.allowed_transitions) ? task.allowed_transitions.filter(taskStatus) : [],
    was_completed: Boolean(task?.was_completed || task?.status === 'COMPLETE'),
  }
}

function normalizeTaskCounts(raw: OrchestratorOverview['task_counts'] | undefined, tasks: OrchestratorTask[]) {
  const counts = emptyOrchestratorTaskCounts()
  const supplied = new Set<OrchestratorTaskStatus>()
  for (const status of ORCHESTRATOR_TASK_STATUSES) {
    const value = raw?.[status]
    if (Number.isFinite(value)) {
      counts[status] = Math.max(0, Number(value))
      supplied.add(status)
    }
  }
  for (const task of tasks) if (!supplied.has(task.status)) counts[task.status] += 1
  return counts
}

export function normalizeOrchestratorOverview(overview: OrchestratorOverview): OrchestratorOverview {
  const tasks = Array.isArray(overview?.tasks) ? overview.tasks.map(normalizeOrchestratorTask) : []
  return {
    ...overview,
    plans: Array.isArray(overview?.plans) ? overview.plans : [],
    tasks,
    task_counts: normalizeTaskCounts(overview?.task_counts, tasks),
    planning_requests: Array.isArray(overview?.planning_requests) ? overview.planning_requests : [],
  }
}

export function normalizeOrchestratorTaskPage(page: OrchestratorTaskPage): OrchestratorTaskPage {
  const tasks = Array.isArray(page?.tasks) ? page.tasks.map(normalizeOrchestratorTask) : []
  return {
    tasks,
    total: Number.isFinite(page?.total) ? Math.max(0, Number(page.total)) : tasks.length,
    next_cursor: typeof page?.next_cursor === 'string' && page.next_cursor ? page.next_cursor : undefined,
    has_more: Boolean(page?.has_more),
  }
}

export function mergeOrchestratorTaskPages(current: OrchestratorTaskPage | undefined, incoming: OrchestratorTaskPage): OrchestratorTaskPage {
  const next = normalizeOrchestratorTaskPage(incoming)
  if (!current) return next
  const tasks = new Map(current.tasks.map((task) => [task.id, task]))
  next.tasks.forEach((task) => tasks.set(task.id, task))
  return { ...next, tasks: [...tasks.values()] }
}

export function combineOrchestratorTasks(active: OrchestratorTask[], pages: OrchestratorTerminalTaskPages) {
  const tasks = new Map<string, OrchestratorTask>()
  ORCHESTRATOR_TERMINAL_STATUSES.forEach((status) => pages[status]?.tasks.forEach((task) => tasks.set(task.id, task)))
  active.forEach((task) => tasks.set(task.id, task))
  return [...tasks.values()]
}

export function reconcileOrchestratorTerminalPages(pages: OrchestratorTerminalTaskPages, task: OrchestratorTask) {
  const normalized = normalizeOrchestratorTask(task)
  const next: OrchestratorTerminalTaskPages = { ...pages }
  ORCHESTRATOR_TERMINAL_STATUSES.forEach((status) => {
    const page = pages[status]
    if (!page) return
    const hadTask = page.tasks.some((item) => item.id === normalized.id)
    const hasTask = normalized.status === status
    const tasks = page.tasks.filter((item) => item.id !== normalized.id)
    if (hasTask) tasks.unshift(normalized)
    next[status] = { ...page, tasks, total: Math.max(0, page.total + Number(hasTask) - Number(hadTask)) }
  })
  return next
}

export function invalidateChangedOrchestratorTerminalPages(pages: OrchestratorTerminalTaskPages, counts: OrchestratorTaskCounts) {
  const next: OrchestratorTerminalTaskPages = { ...pages }
  ORCHESTRATOR_TERMINAL_STATUSES.forEach((status) => {
    if (pages[status] && pages[status]!.total !== counts[status]) delete next[status]
  })
  return next
}

function taskPageSearch(query: OrchestratorTaskPageQuery) {
  const params = new URLSearchParams()
  if (query.status) params.set('status', query.status)
  if (query.q?.trim()) params.set('q', query.q.trim())
  if (query.limit) params.set('limit', String(query.limit))
  if (query.cursor) params.set('cursor', query.cursor)
  const value = params.toString()
  return value ? `?${value}` : ''
}

export function createOrchestratorApi(request: Requester) {
  return {
    orchestratorOverview: (id: string) => request<OrchestratorOverview>(`/api/sessions/${id}/orchestrator/overview`).then(normalizeOrchestratorOverview),
    orchestratorTasks: (id: string, query: OrchestratorTaskPageQuery = {}) => request<OrchestratorTaskPage>(`/api/sessions/${id}/orchestrator/tasks${taskPageSearch(query)}`).then(normalizeOrchestratorTaskPage),
    transitionOrchestratorTask: (id: string, taskId: string, status: OrchestratorTaskStatus) => request<OrchestratorTask>(`/api/sessions/${id}/orchestrator/tasks/${encodeURIComponent(taskId)}/transition`, { method: 'POST', body: JSON.stringify({ status }) }).then(normalizeOrchestratorTask),
  }
}
