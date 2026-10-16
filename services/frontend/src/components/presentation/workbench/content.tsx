import type { ReactNode } from 'react'
import { Icon, type IconName } from '../chrome/Icon'

export function PanelHeader({ title, description, icon, actions }: { title: string; description?: ReactNode; icon?: IconName; actions?: ReactNode }) {
  return <header className="whx-panel-heading flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-whx-border-soft bg-whx-surface !px-4 py-3">
    {icon && <span className="grid size-8 shrink-0 place-items-center text-whx-faint" aria-hidden="true"><Icon name={icon} size={19}/></span>}
    <div className="min-w-0 flex-1"><h2 title={title} className="!m-0 truncate !text-whx-title !font-semibold !leading-tight !text-whx-text">{title}</h2>{description && <p title={typeof description === 'string' ? description : undefined} className="!mb-0 !mt-1 truncate !text-whx-caption !leading-relaxed !text-whx-faint">{description}</p>}</div>
    {actions && <div className="flex shrink-0 items-center gap-1" role="group" aria-label={`Ações de ${title}`}>{actions}</div>}
  </header>
}

export function EmptyState({ title, description, icon = 'workspace', action, compact = false }: { title: string; description: string; icon?: IconName; action?: ReactNode; compact?: boolean }) {
  return <div data-empty-state className={`flex min-w-0 flex-col items-center text-center ${compact ? 'gap-2 px-4 py-6' : 'gap-3 px-6 py-10'}`}>
    <span className="grid size-10 place-items-center rounded-xl bg-whx-muted text-whx-faint" aria-hidden="true"><Icon name={icon} size={21}/></span>
    <strong className="max-w-sm text-whx-label font-semibold text-whx-text">{title}</strong>
    <p className="!m-0 max-w-sm !text-whx-label !leading-relaxed !text-whx-faint">{description}</p>
    {action && <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div>}
  </div>
}

const statusTone = {
  neutral: 'bg-whx-muted text-whx-soft',
  success: 'bg-[color-mix(in_srgb,var(--theme-success)_12%,transparent)] text-whx-success',
  running: 'bg-[color-mix(in_srgb,var(--theme-running)_12%,transparent)] text-whx-running',
  warning: 'bg-[color-mix(in_srgb,var(--theme-warning)_12%,transparent)] text-whx-warning',
  danger: 'bg-[color-mix(in_srgb,var(--theme-danger)_12%,transparent)] text-whx-danger',
  info: 'bg-[color-mix(in_srgb,var(--theme-tab-active)_12%,transparent)] text-[color:var(--theme-tab-active)]',
}
export function StatusBadge({ children, tone = 'neutral', icon }: { children: ReactNode; tone?: keyof typeof statusTone; icon?: IconName }) {
  return <span className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-whx-caption font-medium leading-none ${statusTone[tone]}`}>{icon && <Icon name={icon} size={13}/>}<span>{children}</span></span>
}
