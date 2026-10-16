import type { ReactNode } from 'react'

export const choiceChrome = 'relative inline-flex min-h-8 max-w-full shrink-0 items-center gap-1.5 rounded-md border border-whx-border-soft bg-whx-surface px-2 text-whx-soft transition-colors motion-reduce:transition-none hover:border-whx-border focus-within:ring-2 focus-within:ring-whx-accent'
export const choiceControl = 'h-7! min-h-0! w-auto! min-w-0! max-w-[210px]! cursor-pointer appearance-none rounded-md! border-0! bg-transparent! py-0! pl-0.5! pr-4! font-sans text-whx-label! font-medium! text-whx-soft! outline-none! disabled:cursor-default disabled:opacity-50'

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
