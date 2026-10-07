import type { TaskPolicyState } from '../../../../lib/agent/automationHolds'

// The legacy global `button` rules set padding, font size and background;
// the important modifiers keep these compact controls from inheriting them.
export const iconButton = 'grid h-7! w-7! min-h-0! shrink-0 place-items-center rounded-lg! border! border-transparent! bg-transparent! p-0! text-[var(--theme-text-muted)] transition hover:border-white/10! hover:bg-white/[0.06]! hover:text-[var(--theme-text)] disabled:opacity-40'

export const toneButton = {
  pause: `${iconButton} hover:text-amber-200!`,
  play: `${iconButton} hover:text-emerald-200!`,
  confirm: `${iconButton} text-emerald-300! hover:bg-emerald-400/10!`,
  cancel: iconButton,
}

export const chipButton = 'h-6! min-h-0! rounded-md! border! border-white/10! bg-transparent! px-2! py-0! text-[11px]! leading-none text-[var(--theme-text-muted)] transition hover:border-white/20! hover:text-[var(--theme-text)] aria-pressed:border-[var(--acid)]/50! aria-pressed:bg-[var(--acid)]/10! aria-pressed:text-[var(--theme-text)]'

export const stateDot: Record<TaskPolicyState, string> = {
  active: 'bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.12)]',
  suspended: 'bg-amber-300 shadow-[0_0_0_3px_rgba(252,211,77,0.14)]',
  cooldown: 'bg-sky-300 shadow-[0_0_0_3px_rgba(125,211,252,0.14)] animate-pulse',
}

export const stateText: Record<TaskPolicyState, string> = {
  active: 'text-emerald-300/90',
  suspended: 'text-amber-200/90',
  cooldown: 'text-sky-200/90',
}
