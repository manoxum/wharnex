import { type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useRef, useState } from 'react'
import { ORCHESTRATOR_TASK_STATUSES, ORCHESTRATOR_TERMINAL_STATUSES, type EffortLevel, type OrchestratorTask, type OrchestratorTaskCounts, type OrchestratorTaskStatus, type OrchestratorTerminalTaskPages, type OrchestratorTerminalTaskStatus, type Session } from '../../types'
import { TASK_EFFORT_LEVELS, taskEffortLevel } from '../../lib/orchestratorEffort'
import { Icon } from '../Icon'
import { Status } from './OrchestratorStatus'

export function OrchestratorKanban({ tasks, taskCounts, terminalPages, searching, session, busy, dragTask, loadingStatus, onEffort, onDrag, onDrop, onLoadMore, onSelect }: {
  tasks: OrchestratorTask[]
  taskCounts: OrchestratorTaskCounts
  terminalPages: OrchestratorTerminalTaskPages
  searching: boolean
  session: Session
  busy: boolean
  dragTask?: string
  loadingStatus?: OrchestratorTerminalTaskStatus
  onEffort: (task: OrchestratorTask, level: EffortLevel) => void
  onDrag: (id?: string) => void
  onDrop: (status: OrchestratorTaskStatus) => void
  onLoadMore: (status: OrchestratorTerminalTaskStatus) => void
  onSelect: (task: OrchestratorTask) => void
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [canScrollBack, setCanScrollBack] = useState(false)
  const [canScrollForward, setCanScrollForward] = useState(false)
  const hasOverflow = canScrollBack || canScrollForward

  const updateScrollControls = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    setCanScrollBack(viewport.scrollLeft > 1)
    setCanScrollForward(viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 1)
  }, [])

  useEffect(() => {
    updateScrollControls()
    const viewport = viewportRef.current
    if (!viewport || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateScrollControls)
    observer.observe(viewport)
    const track = viewport.firstElementChild
    if (track instanceof HTMLElement) observer.observe(track)
    return () => observer.disconnect()
  }, [tasks.length, taskCounts.COMPLETE, taskCounts.ARCHIVED, updateScrollControls])

  function scrollByColumn(direction: -1 | 1) {
    const viewport = viewportRef.current
    if (!viewport) return
    const column = viewport.querySelector<HTMLElement>('[data-kanban-column]')
    const amount = (column?.offsetWidth || Math.min(Math.max(viewport.clientWidth * .8, 240), 320)) + 8
    const left = Math.max(0, viewport.scrollLeft + direction * amount)
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (typeof viewport.scrollTo === 'function') viewport.scrollTo({ left, behavior: reduced ? 'auto' : 'smooth' })
    else viewport.scrollLeft = left
  }

  function autoScrollDrag(event: ReactDragEvent<HTMLDivElement>) {
    if (!dragTask) return
    const viewport = viewportRef.current
    if (!viewport) return
    const bounds = viewport.getBoundingClientRect()
    const delta = event.clientX < bounds.left + 56 ? -28 : event.clientX > bounds.right - 56 ? 28 : 0
    if (!delta) return
    if (typeof viewport.scrollBy === 'function') viewport.scrollBy({ left: delta, behavior: 'auto' })
    else viewport.scrollLeft += delta
  }

  function activateCard(event: ReactKeyboardEvent<HTMLElement>, task: OrchestratorTask) {
    if (event.currentTarget !== event.target || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onSelect(task)
  }

  return <div className="relative h-full min-h-0 overflow-hidden">
    {hasOverflow && <button type="button" aria-label="Ver coluna anterior" disabled={!canScrollBack} onClick={() => scrollByColumn(-1)} className="absolute left-2 top-1/2 z-20 grid size-9 -translate-y-1/2 place-items-center rounded-full border border-[var(--theme-border)] bg-[var(--theme-elevated)] text-[var(--theme-text)] shadow-lg outline-none hover:bg-[var(--theme-hover)] focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] disabled:cursor-default disabled:opacity-40"><Icon name="arrow-left" size={16}/></button>}
    {hasOverflow && <button type="button" aria-label="Ver coluna seguinte" disabled={!canScrollForward} onClick={() => scrollByColumn(1)} className="absolute right-2 top-1/2 z-20 grid size-9 -translate-y-1/2 place-items-center rounded-full border border-[var(--theme-border)] bg-[var(--theme-elevated)] text-[var(--theme-text)] shadow-lg outline-none hover:bg-[var(--theme-hover)] focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] disabled:cursor-default disabled:opacity-40"><Icon name="arrow-right" size={16}/></button>}
    <div ref={viewportRef} data-testid="orchestrator-kanban-scroll" onScroll={updateScrollControls} onDragOver={autoScrollDrag} className="h-full min-h-0 scroll-smooth overflow-x-auto overflow-y-auto p-3 motion-reduce:scroll-auto [scrollbar-gutter:stable]">
      <div className="flex min-h-full w-max min-w-full flex-nowrap gap-2">
        {ORCHESTRATOR_TASK_STATUSES.map((status) => {
          const grouped = tasks.filter((task) => task.status === status)
          const terminal = ORCHESTRATOR_TERMINAL_STATUSES.includes(status as OrchestratorTerminalTaskStatus)
          const page = terminal ? terminalPages[status as OrchestratorTerminalTaskStatus] : undefined
          const total = terminal ? (searching ? page?.total ?? 0 : taskCounts[status]) : grouped.length
          const droppable = status === 'PENDING' || status === 'WAITING' || status === 'READY'
          return <section key={status} data-kanban-column={status} tabIndex={0} aria-label={`Coluna ${status}, ${total} tarefas`} className="grid min-h-[300px] w-[min(82vw,18rem)] min-w-[17rem] shrink-0 grid-rows-[35px_minmax(0,1fr)] rounded-xl border border-[var(--theme-border-soft)] bg-[var(--theme-elevated)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]" onDragOver={(event) => { if (droppable) event.preventDefault() }} onDrop={() => { if (droppable) onDrop(status) }}>
            <header className="flex items-center justify-between border-b border-[var(--theme-border-soft)] px-2 py-1.5"><Status status={status}/><span className="font-mono text-sm leading-none text-[var(--theme-text-soft)]">{total}</span></header>
            <div className="flex min-h-0 flex-col gap-1.5 p-1.5">
              {grouped.map((task) => <article key={task.id} role="button" tabIndex={0} draggable={task.status !== 'DOING'} className={`grid gap-1.5 rounded-lg border border-[var(--theme-border-soft)] bg-[var(--theme-surface)] p-2.5 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] ${dragTask === task.id ? 'opacity-40' : ''}`} onDragStart={() => onDrag(task.id)} onDragEnd={() => onDrag(undefined)} onClick={() => onSelect(task)} onKeyDown={(event) => activateCard(event, task)}>
                <div className="flex items-center gap-1.5"><span className={`priority priority-${task.priority} font-mono text-sm leading-[1.4]`}>{task.priority}</span>{task.parallelizable && <span className="parallel font-mono text-sm leading-[1.4] text-[var(--theme-text-soft)]">parallel</span>}</div>
                <strong className="text-base leading-[1.35]">{task.title}</strong>
                <p className="m-0 line-clamp-3 text-sm leading-[1.45] text-[var(--theme-text-muted)]">{task.description || 'Sem descrição adicional.'}</p>
                <label className="mt-1 flex items-center justify-between gap-2 text-sm text-[var(--theme-muted)]" title="Nível de esforço · tentativas automáticas antes de a task falhar" onClick={(event) => event.stopPropagation()}>Esforço<select aria-label={`Esforço de ${task.title}`} className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-surface)] px-2 py-1 text-base text-[var(--theme-text)]" value={taskEffortLevel(task, session)} disabled={busy} onChange={(event) => onEffort(task, event.target.value as EffortLevel)}>{TASK_EFFORT_LEVELS.map((level) => <option key={level.value} value={level.value}>{level.label}</option>)}</select></label>
                <footer className="flex justify-between gap-1.5 font-mono text-sm text-[var(--theme-text-soft)]"><span>{task.depends_on?.length || 0} deps</span><span>{task.capability || task.complexity || 'task'}</span></footer>
              </article>)}
              {!grouped.length && <div className="m-auto rounded-lg border border-dashed border-[var(--theme-border-soft)] px-2 py-3 text-center text-base text-[var(--theme-text-soft)]">{terminal ? 'Nenhuma task carregada' : 'Arraste uma task para aqui'}</div>}
              {terminal && page?.has_more && <button type="button" disabled={loadingStatus === status} onClick={() => onLoadMore(status as OrchestratorTerminalTaskStatus)} className="mt-auto min-h-8 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 text-base font-semibold text-[var(--theme-text)] outline-none hover:bg-[var(--theme-hover)] focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] disabled:opacity-50">{loadingStatus === status ? 'A carregar…' : 'Carregar mais'}</button>}
            </div>
          </section>
        })}
      </div>
    </div>
  </div>
}
