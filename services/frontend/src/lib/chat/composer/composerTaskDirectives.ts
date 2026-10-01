import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { OrchestratorTask, OrchestratorTaskPage, OrchestratorTerminalTaskStatus } from '../../../types'
import { api } from '../../transport/http/api'

const TASK_PAGE_SIZE = 8
const TASK_STATUSES: OrchestratorTerminalTaskStatus[] = ['COMPLETE', 'ARCHIVED']

type CursorState = Record<OrchestratorTerminalTaskStatus, string | null | undefined>

export type ComposerTaskDirectiveCandidate = {
  value: string
  label: string
  detail: string
  task: OrchestratorTask
}

export type ComposerTaskDirectivePage = {
  tasks: OrchestratorTask[]
  candidates: ComposerTaskDirectiveCandidate[]
  cursors: CursorState
  hasMore: boolean
}

export function validTaskDirectiveValue(value: string) {
  return /^[A-Za-z0-9._-]+$/.test(value)
}

export function canonicalTaskDirective(value: string) {
  if (!validTaskDirectiveValue(value)) throw new Error('invalid task directive id')
  return `@{[task]${value}}`
}

export function completedTaskReference(task: OrchestratorTask) {
  return task.status === 'COMPLETE' || (task.status === 'ARCHIVED' && task.was_completed === true)
}

export function taskDirectiveCandidate(task: OrchestratorTask): ComposerTaskDirectiveCandidate {
  return {
    value: task.id,
    label: task.title,
    detail: `${task.id} · ${task.status === 'ARCHIVED' ? 'Arquivada após conclusão' : 'Concluída'}`,
    task,
  }
}

function mergeUniqueTasks(...groups: OrchestratorTask[][]) {
  const unique = new Map<string, OrchestratorTask>()
  groups.flat().forEach((task) => { if (completedTaskReference(task)) unique.set(task.id, task) })
  return [...unique.values()].sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at) || left.title.localeCompare(right.title, 'pt'))
}

async function loadStatus(sessionId: string, status: OrchestratorTerminalTaskStatus, query: string, cursor: string | null | undefined) {
  if (cursor === null) return { tasks: [], total: 0, has_more: false } satisfies OrchestratorTaskPage
  return api.orchestratorTasks(sessionId, { status, q: query || undefined, limit: TASK_PAGE_SIZE, cursor: cursor || undefined })
}

export async function loadComposerTaskDirectivePage(sessionId: string, query = '', cursors: CursorState = { COMPLETE: undefined, ARCHIVED: undefined }): Promise<ComposerTaskDirectivePage> {
  const [complete, archived] = await Promise.all(TASK_STATUSES.map((status) => loadStatus(sessionId, status, query.trim(), cursors[status])))
  const tasks = mergeUniqueTasks(complete.tasks, archived.tasks)
  const nextCursors: CursorState = {
    COMPLETE: complete.has_more && complete.next_cursor ? complete.next_cursor : null,
    ARCHIVED: archived.has_more && archived.next_cursor ? archived.next_cursor : null,
  }
  return { tasks, candidates: tasks.map(taskDirectiveCandidate), cursors: nextCursors, hasMore: TASK_STATUSES.some((status) => nextCursors[status] !== null) }
}

export function useComposerTaskDirectiveSuggestions(sessionId: string, query: string | undefined) {
  const [tasks, setTasks] = useState<OrchestratorTask[]>([])
  const [knownTasks, setKnownTasks] = useState<OrchestratorTask[]>([])
  const [cursors, setCursors] = useState<CursorState>({ COMPLETE: undefined, ARCHIVED: undefined })
  const [loading, setLoading] = useState(false)
  const revisionRef = useRef(0)
  const normalizedQuery = query?.trim()

  const mergeKnown = useCallback((incoming: OrchestratorTask[]) => {
    setKnownTasks((current) => mergeUniqueTasks(current, incoming))
  }, [])

  useEffect(() => {
    if (query === undefined) return
    const revision = ++revisionRef.current
    setTasks([]); setCursors({ COMPLETE: undefined, ARCHIVED: undefined }); setLoading(true)
    const timer = window.setTimeout(() => {
      void loadComposerTaskDirectivePage(sessionId, normalizedQuery || '').then((page) => {
        if (revision !== revisionRef.current) return
        setTasks(page.tasks); setCursors(page.cursors); mergeKnown(page.tasks)
      }).catch(() => {
        if (revision !== revisionRef.current) return
        setTasks([]); setCursors({ COMPLETE: null, ARCHIVED: null })
      }).finally(() => { if (revision === revisionRef.current) setLoading(false) })
    }, 120)
    return () => window.clearTimeout(timer)
  }, [mergeKnown, normalizedQuery, query, sessionId])

  const loadMore = useCallback(async () => {
    if (query === undefined || loading || TASK_STATUSES.every((status) => cursors[status] === null)) return
    setLoading(true)
    try {
      const page = await loadComposerTaskDirectivePage(sessionId, normalizedQuery || '', cursors)
      setTasks((current) => mergeUniqueTasks(current, page.tasks)); setCursors(page.cursors); mergeKnown(page.tasks)
    } catch { setCursors({ COMPLETE: null, ARCHIVED: null }) }
    finally { setLoading(false) }
  }, [cursors, loading, mergeKnown, normalizedQuery, query, sessionId])

  return {
    suggestions: useMemo(() => tasks.map(taskDirectiveCandidate), [tasks]),
    knownTasks,
    loading,
    hasMore: query !== undefined && TASK_STATUSES.some((status) => cursors[status] !== null),
    loadMore,
  }
}
