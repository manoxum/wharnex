import { useState, type ReactNode } from 'react'
import { Icon } from './Icon'

type TaskSource = 'chat' | 'worker' | 'translation' | 'release' | 'todo' | 'orchestrator' | 'system'
type TaskDisposition = 'queue' | 'completed' | 'archived'
type TaskTone = TaskDisposition | 'failed'

const RAIL_TONE: Record<TaskTone, string> = {
  queue: 'bg-whx-warning',
  completed: 'bg-whx-success',
  archived: 'bg-whx-faint',
  failed: 'bg-whx-danger',
}

const STATE_TONE: Record<TaskTone, string> = {
  queue: 'text-whx-warning',
  completed: 'text-whx-success',
  archived: 'text-whx-faint',
  failed: 'text-whx-danger',
}

const SOURCE_TONE: Record<TaskSource, string> = {
  chat: 'text-whx-accent',
  worker: 'text-whx-accent',
  orchestrator: 'text-whx-accent',
  translation: 'text-whx-success',
  release: 'text-whx-success',
  todo: 'text-whx-success',
  system: 'text-whx-faint',
}

export function ProjectTaskCardShell({
  disposition,
  failed,
  source,
  sourceLabel,
  sourceIcon,
  stateLabel,
  title,
  updatedAt,
  updatedLabel,
  prompt,
  rootRequestId,
  metadata,
  onGoToChat,
  renderDetails,
}: {
  disposition: TaskDisposition
  failed: boolean
  source: TaskSource
  sourceLabel: string
  sourceIcon: ReactNode
  stateLabel: string
  title: string
  updatedAt: string
  updatedLabel: string
  prompt: string
  rootRequestId: string
  metadata: ReactNode
  onGoToChat?: () => void
  renderDetails: () => ReactNode
}) {
  const [opened, setOpened] = useState(false)
  const tone: TaskTone = failed ? 'failed' : disposition

  return <article data-project-task-card className="group relative grid min-w-0 gap-2 overflow-hidden rounded-xl border border-whx-border-soft bg-whx-surface p-3 pl-4 transition-[border-color,background-color,transform] duration-150 hover:-translate-y-px hover:border-whx-border hover:bg-whx-hover">
    <span aria-hidden="true" className={`absolute inset-y-3 left-0 w-0.5 rounded-r-full ${RAIL_TONE[tone]}`}/>
    <header className="grid min-w-0 gap-2">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className={`inline-flex max-w-full items-center gap-1 rounded-full border border-whx-border-soft bg-whx-bg px-1.5 py-0.5 text-xs font-bold uppercase tracking-[0.045em] ${SOURCE_TONE[source]}`}>{sourceIcon}{sourceLabel}</span>
          <span className={`inline-flex max-w-full items-center gap-1 rounded-full border border-whx-border-soft bg-whx-bg px-1.5 py-0.5 text-xs font-bold uppercase tracking-[0.045em] ${STATE_TONE[tone]}`}><i aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current"/>{stateLabel}</span>
        </div>
        <time className="shrink-0 pt-0.5 text-right font-mono text-xs font-semibold text-whx-faint" dateTime={updatedAt}>{updatedLabel}</time>
      </div>
      <strong className="min-w-0 overflow-hidden text-base font-semibold leading-[1.3] text-whx-text [display:-webkit-box] [overflow-wrap:anywhere] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">{title}</strong>
    </header>
    <p className="m-0 min-w-0 overflow-hidden whitespace-pre-line rounded-lg border border-whx-border-soft bg-whx-bg px-2.5 py-2 text-sm leading-[1.45] text-whx-soft [display:-webkit-box] [overflow-wrap:anywhere] [-webkit-box-orient:vertical] [-webkit-line-clamp:3]">{prompt}</p>
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-whx-faint [&>span]:max-w-full [&>span]:min-w-0 [&>span]:break-words [&>span]:rounded-md [&>span]:bg-whx-muted [&>span]:px-1.5 [&>span]:py-1 [&>.danger]:text-whx-danger">
      <code className="max-w-full min-w-0 break-all whitespace-normal rounded-md bg-whx-muted px-1.5 py-1 font-mono font-semibold leading-relaxed text-whx-accent">{rootRequestId}</code>
      {metadata}
    </div>
    {onGoToChat ? <div className="flex items-center"><button type="button" className="inline-flex min-h-7 items-center gap-1.5 rounded-lg border border-whx-border-soft bg-whx-bg px-2.5 text-xs font-bold text-whx-soft transition-colors hover:border-whx-border hover:bg-whx-hover hover:text-whx-text" onClick={onGoToChat}><Icon name="bridge" size={12}/> Ver chat</button></div> : null}
    <details className="project-task-details" onToggle={(event) => setOpened(event.currentTarget.open)}><summary><span>Detalhes, planos, execuções, logs e metadados</span></summary>{opened ? renderDetails() : null}</details>
  </article>
}
