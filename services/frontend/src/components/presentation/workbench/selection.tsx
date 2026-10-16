import type { ButtonHTMLAttributes } from 'react'
import { IconButton } from './controls'

export function Switch({ label, checked, onChange, className = '', ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & { label: string; checked: boolean; onChange: () => void }) {
  return <button {...props} type="button" role="switch" aria-label={label} aria-checked={checked} onClick={onChange} className={`!inline-flex !h-8 !min-h-8 !w-11 !shrink-0 !items-center !justify-center !rounded-md !border-0 !bg-transparent !p-0 !shadow-none focus-visible:!outline-whx-accent disabled:!opacity-40 ${className}`}>
    <span className={`relative inline-block h-5 w-9 rounded-full transition-colors motion-reduce:transition-none ${checked ? 'bg-whx-accent' : 'bg-whx-border'}`} aria-hidden="true"><span className={`absolute left-0.5 top-0.5 size-4 rounded-full transition-transform motion-reduce:transition-none ${checked ? 'translate-x-4 bg-[var(--theme-bg)]' : 'bg-whx-text'}`}/></span>
  </button>
}

export function NumberStepper({ label, value, min, max, disabled = false, onChange }: { label: string; value: number; min: number; max: number; disabled?: boolean; onChange: (delta: number) => void }) {
  return <div className="inline-flex items-center rounded-md border border-whx-border bg-whx-surface" role="group" aria-label={label}>
    <IconButton icon="minus" label={`Diminuir ${label}`} disabled={disabled || value <= min} onClick={() => onChange(-1)}/>
    <output className="min-w-7 text-center font-mono text-whx-label text-whx-text" aria-live="polite">{value}</output>
    <IconButton icon="plus" label={`Aumentar ${label}`} disabled={disabled || value >= max} onClick={() => onChange(1)}/>
  </div>
}
