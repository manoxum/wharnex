import { useState } from 'react'
import { Icon } from '../../../presentation/chrome/Icon'
import { chipButton, toneButton } from './taskPolicyStyles'

const PRESETS = [[15, '15 min'], [60, '1 h'], [240, '4 h'], [1440, '24 h']] as const
const MAX_MINUTES = 10_080

// How a suspension ends: manual resume, or automatically after a duration.
// Inline by design: a modal would open underneath the browser monitor's
// native view.
export function SuspendChooser({ subject, busy, onConfirm, onCancel }: {
  subject: string
  busy: boolean
  onConfirm: (until?: string) => void
  onCancel: () => void
}) {
  const [mode, setMode] = useState<'manual' | 'timed'>('manual')
  const [minutes, setMinutes] = useState('60')
  const value = Number(minutes)
  const valid = mode === 'manual' || (Number.isInteger(value) && value >= 1 && value <= MAX_MINUTES)
  const confirm = () => onConfirm(mode === 'timed' ? new Date(Date.now() + value * 60_000).toISOString() : undefined)
  return <div role="group" aria-label={`Suspender ${subject}`} className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5">
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Retoma">
      <button type="button" role="radio" aria-checked={mode === 'manual'} aria-pressed={mode === 'manual'} className={chipButton} onClick={() => setMode('manual')}>Manual</button>
      <button type="button" role="radio" aria-checked={mode === 'timed'} aria-pressed={mode === 'timed'} className={chipButton} onClick={() => setMode('timed')}>Automática</button>
    </div>
    {mode === 'timed' && <div className="flex flex-wrap items-center gap-1">
      {PRESETS.map(([preset, label]) => <button key={preset} type="button" aria-pressed={value === preset} className={chipButton} onClick={() => setMinutes(String(preset))}>{label}</button>)}
      <label className="flex items-center gap-1 text-[11px] text-[var(--theme-text-muted)]">
        <input aria-label="Minutos até retomar" type="number" min={1} max={MAX_MINUTES} step={1} value={minutes} onChange={(event) => setMinutes(event.target.value)}
          className="h-6! w-14! min-h-0! rounded-md! border! border-white/10! bg-transparent! px-1.5! py-0! text-[11px]! text-[var(--theme-text)]"/>min
      </label>
    </div>}
    <span className="ml-auto flex items-center">
      <button type="button" className={toneButton.confirm} disabled={busy || !valid} onClick={confirm} aria-label="Confirmar suspensão" title="Confirmar suspensão"><Icon name="check" size={14}/></button>
      <button type="button" className={toneButton.cancel} onClick={onCancel} aria-label="Cancelar" title="Cancelar"><Icon name="close" size={13}/></button>
    </span>
  </div>
}
