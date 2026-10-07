import { useState } from 'react'
import type { TaskPolicy, TaskPolicyState } from '../../../../lib/agent/automationHolds'
import { Icon } from '../../../presentation/chrome/Icon'
import { SuspendChooser } from './SuspendChooser'
import { groupTaskPolicies, stateLabels, type CategoryView } from './taskPolicyCatalog'
import { stateDot, toneButton } from './taskPolicyStyles'
import { TaskPolicyRow } from './TaskPolicyRow'
import { useTaskPolicies, type TaskPolicyDeps } from './useTaskPolicies'

const STATES: TaskPolicyState[] = ['active', 'suspended', 'cooldown']

// Every browser task type, grouped by purpose, with its effective state and
// the one action that state needs. The state is the backend's; this surface
// never infers it.
export function AgentTaskPolicies(props: TaskPolicyDeps) {
  const { policies, busy, pending, cancelPending, suspend, resume, resumeHolds } = useTaskPolicies(props)
  // Which row or category ("cat:<id>") has its suspension chooser open.
  const [choosing, setChoosing] = useState<string>()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  if (!policies) return <div className="h-24 animate-pulse rounded-xl bg-white/[0.04]" aria-label="A carregar políticas por tipo"/>
  const toggle = (id: string) => setCollapsed((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const close = () => setChoosing(undefined)
  return <section aria-label="Políticas por tipo de tarefa" className="space-y-2.5">
    <header className="flex items-end justify-between gap-3 px-0.5">
      <div>
        <h3 className="text-[13px] font-semibold tracking-tight">Políticas por tipo</h3>
        <p className="text-[11px] text-[var(--theme-text-muted)]" title="Suspender pára novos claims desse tipo em todos os pools, sem gastar tentativas; o trabalho em curso termina normalmente.">Pausa novos claims em todos os pools, sem gastar tentativas.</p>
      </div>
      <StateCounts policies={policies}/>
    </header>
    {groupTaskPolicies(policies).map((view) => <CategoryCard key={view.category.id} view={view} busy={busy} open={!collapsed.has(view.category.id)} onToggle={() => toggle(view.category.id)}
      choosing={choosing} onChoose={setChoosing} onClose={close}
      onSuspend={(types, until) => { close(); void suspend(types, until) }}
      onResumeAll={(types) => void resumeHolds(types)}
      pending={pending} onCancelPending={cancelPending} onResume={(policy, confirmed) => void resume(policy, { confirmed })}/>)}
  </section>
}

type CardProps = {
  view: CategoryView
  busy: boolean
  open: boolean
  onToggle: () => void
  choosing?: string
  onChoose: (key: string) => void
  onClose: () => void
  onSuspend: (types: string[], until?: string) => void
  onResumeAll: (types: string[]) => void
  pending?: string
  onCancelPending: () => void
  onResume: (policy: TaskPolicy, confirmed?: boolean) => void
}

function CategoryCard({ view: { category, items }, busy, open, onToggle, choosing, onChoose, onClose, onSuspend, onResumeAll, pending, onCancelPending, onResume }: CardProps) {
  const policies = items.map(({ policy }) => policy)
  const suspended = policies.filter((policy) => policy.state === 'suspended').map((policy) => policy.type)
  const running = policies.filter((policy) => policy.state !== 'suspended').map((policy) => policy.type)
  const categoryKey = `cat:${category.id}`
  return <section aria-label={category.label} className="overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.015]">
    <header className="flex items-center gap-2 px-3 py-2">
      <button type="button" onClick={onToggle} aria-expanded={open} title={category.description}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md! border-0! bg-transparent! p-0! text-left text-[var(--theme-text)]">
        <span className={`text-[var(--theme-text-muted)] transition ${open ? 'rotate-90' : ''}`}><Icon name="chevron" size={12}/></span>
        <span className="truncate text-[12px] font-semibold tracking-tight">{category.label}</span>
      </button>
      <StateCounts policies={policies}/>
      {running.length > 0 && <button type="button" className={toneButton.pause} disabled={busy} onClick={() => choosing === categoryKey ? onClose() : onChoose(categoryKey)} aria-expanded={choosing === categoryKey} aria-label={`Suspender todos: ${category.label}`} title="Suspender todos"><Icon name="pause" size={13}/></button>}
      {suspended.length > 0 && <button type="button" className={toneButton.play} disabled={busy} onClick={() => onResumeAll(suspended)} aria-label={`Retomar todos: ${category.label}`} title="Retomar todos"><Icon name="play" size={13}/></button>}
    </header>
    {choosing === categoryKey && <div className="px-3 pb-2"><SuspendChooser subject={category.label} busy={busy} onConfirm={(until) => onSuspend(running, until)} onCancel={onClose}/></div>}
    {open && <ul className="divide-y divide-white/[0.05] border-t border-white/[0.06]">{items.map(({ policy, label }) => <TaskPolicyRow key={policy.type} policy={policy} label={label} busy={busy}
      choosing={choosing === policy.type} onChoose={() => onChoose(policy.type)} onCloseChooser={onClose}
      onSuspend={(until) => onSuspend([policy.type], until)}
      confirmingCooldown={pending === policy.type} onCancelCooldown={onCancelPending} onResume={(confirmed) => onResume(policy, confirmed)}/>)}</ul>}
  </section>
}

function StateCounts({ policies }: { policies: TaskPolicy[] }) {
  return <span className="flex shrink-0 items-center gap-2 text-[10.5px] tabular-nums text-[var(--theme-text-muted)]">
    {STATES.map((state) => {
      const count = policies.filter((policy) => policy.state === state).length
      return count > 0 && <span key={state} className="inline-flex items-center gap-1" title={`${count} ${stateLabels[state].toLowerCase()}`} aria-label={`${count} ${stateLabels[state].toLowerCase()}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${stateDot[state]}`}/>{count}
      </span>
    })}
  </span>
}
