import type { KeyboardEvent } from 'react'

export function navigateTools(event: KeyboardEvent<HTMLElement>) {
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-workspace-tool]:not(:disabled)'))
  const index = buttons.indexOf(event.target as HTMLButtonElement)
  if (index < 0 || !buttons.length) return
  event.preventDefault()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length
  buttons[next].focus()
}
