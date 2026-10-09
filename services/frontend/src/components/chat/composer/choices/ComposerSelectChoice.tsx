import type { ReactNode } from 'react'

export const choiceChrome = 'relative inline-flex h-[29px] shrink-0 items-center gap-1 rounded-[var(--radius-popover)] border border-whx-border-soft bg-whx-muted px-1.5 text-whx-soft transition-colors hover:border-whx-border focus-within:border-whx-accent'
export const choiceControl = 'h-[23px]! min-h-0! w-auto! min-w-0! cursor-pointer appearance-none rounded-[var(--radius-control)]! border-0! bg-transparent! py-0! pl-0.5! pr-3.5! font-sans text-[calc(8.5px*var(--ui-font-scale))]! font-bold! text-whx-soft! outline-none! disabled:cursor-default disabled:opacity-50'

export function ComposerSelectChoice<Value extends string>({ label, title, icon, value, options, disabled, onChange }: {
  label: string
  title: string
  icon: ReactNode
  value: Value
  options: ReadonlyArray<{ value: Value; label: string }>
  disabled?: boolean
  onChange?: (value: Value) => void
}) {
  return <label className={choiceChrome} title={title}>
    {icon}
    <select className={choiceControl} aria-label={label} value={value} disabled={disabled || !onChange}
      onChange={(event) => onChange?.(event.target.value as Value)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    <span aria-hidden="true" className="pointer-events-none absolute right-2 h-1 w-1 rotate-45 border-b border-r border-current opacity-70" />
  </label>
}
