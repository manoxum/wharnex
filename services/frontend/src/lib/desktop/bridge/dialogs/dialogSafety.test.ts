import { expect, it } from 'vitest'
import { confirmDialog, saveChangesDialog } from '../appDialog'
it('offers a single explicit discard decision and restores focus after cancellation', async () => {
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus()
  const decision = saveChangesDialog({ title: 'Guardar ficheiros?', tone: 'warning', confirmLabel: 'Guardar' })
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.app-dialog-actions button')]
  expect(buttons.map((item) => item.textContent)).toEqual(['Cancelar', 'Não guardar', 'Guardar'])
  buttons[1].click()
  await expect(decision).resolves.toBe('discard')
  expect(document.activeElement).toBe(trigger)
  trigger.remove()
})
it('traps focus and gives destructive confirmation an initial cancel action', async () => {
  const decision = confirmDialog({ title: 'Apagar?', tone: 'danger' })
  await new Promise((resolve) => setTimeout(resolve, 25))
  expect(document.activeElement?.textContent).toBe('Cancelar')
  const elements = [...document.querySelectorAll<HTMLElement>('.internal-window-shell button:not(:disabled)')]
  elements.at(-1)?.focus()
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
  expect(document.activeElement).toBe(elements[0])
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await expect(decision).resolves.toBe(false)
})
