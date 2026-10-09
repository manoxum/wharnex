import type { TaskPolicy } from '../../../../lib/agent/automationHolds'
import { Icon } from '../../../presentation/chrome/Icon'
import { SuspendChooser } from './SuspendChooser'
import { poolLabels, stateDetail, stateLabels } from './taskPolicyCatalog'
import { stateDot, stateText, toneButton } from './taskPolicyStyles'

type Props = {
  policy: TaskPolicy
  label: string
  busy: boolean
  choosing: boolean
  confirmingCooldown: boolean
  onChoose: () => void
  onCloseChooser: () => void
  onSuspend: (until?: string) => void
  onResume: (confirmed?: boolean) => void
  onCancelCooldown: () => void
}

export function TaskPolicyRow({ policy, label, busy, choosing, confirmingCooldown, onChoose, onCloseChooser, onSuspend, onResume, onCancelCooldown }: Props) {
  const detail = stateDetail(policy)
  return <li className="group px-3 py-2 transition hover:bg-white/[0.025]">
    <div className="flex items-center gap-3">
      <span className={`h-2 w-2 shrink-0 rounded-full ${stateDot[policy.state]}`} data-state={policy.state} role="img" aria-label={stateLabels[policy.state]} title={stateLabels[policy.state]}/>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[12.5px] text-[var(--theme-text)]">{label}</span>
          <code className="truncate font-mono text-[10px] text-[var(--theme-text-muted)] opacity-0 transition group-hover:opacity-100">{policy.type}</code>
        </div>
        <div className="flex items-center gap-1.5 text-[10.5px] text-[var(--theme-text-muted)]">
          <span>{poolLabels[policy.pool]}</span>
          {policy.uploads && <span className="inline-flex items-center opacity-70" title="Envia ficheiros (sujeito ao limite de upload)" aria-label="Envia ficheiros"><Icon name="file" size={10}/></span>}
          {detail && <><span aria-hidden="true">·</span><span className={stateText[policy.state]}>{detail}</span></>}
        </div>
      </div>
      {policy.state === 'active'
        ? <button type="button" className={toneButton.pause} disabled={busy} onClick={choosing ? onCloseChooser : onChoose} aria-expanded={choosing} aria-label={`Suspender ${policy.type}`} title="Suspender"><Icon name="pause" size={13}/></button>
        : <button type="button" className={toneButton.play} disabled={busy} onClick={() => onResume()} aria-label={`Retomar ${policy.type}`} title={policy.state === 'cooldown' ? 'Libertar cooldown' : 'Retomar'}><Icon name="play" size={13}/></button>}
    </div>
    {choosing && <SuspendChooser subject={label} busy={busy} onConfirm={onSuspend} onCancel={onCloseChooser}/>}
    {confirmingCooldown && <div role="group" aria-label="Confirmar libertação do cooldown" className="mt-2 flex items-center gap-2 rounded-lg border border-sky-300/20 bg-sky-300/[0.06] px-2 py-1.5 text-[11px] text-sky-100">
      <Icon name="alert" size={12}/>
      <span className="min-w-0 flex-1">Libertar o cooldown para todos os tipos afetados?</span>
      <button type="button" className={toneButton.confirm} disabled={busy} onClick={() => onResume(true)} aria-label="Confirmar libertação" title="Confirmar"><Icon name="check" size={14}/></button>
      <button type="button" className={toneButton.cancel} onClick={onCancelCooldown} aria-label="Cancelar" title="Cancelar"><Icon name="close" size={13}/></button>
    </div>}
  </li>
}
