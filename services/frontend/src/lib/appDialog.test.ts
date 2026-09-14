import { afterEach, describe, expect, it } from 'vitest'
import { confirmDialog, noticeDialog, promptDialog } from './appDialog'

afterEach(() => {
  document.querySelectorAll('.app-dialog-backdrop').forEach((element) => element.remove())
  document.documentElement.classList.remove('app-dialog-open')
})

describe('appDialog', () => {

  it('keeps native browser alert, confirm and prompt APIs out of frontend source', () => {
    const sources = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.endsWith('/appDialog.test.ts'))
      .filter(([, content]) => /\bwindow\.(alert|confirm|prompt)\s*\(/.test(content))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('renders an application-owned confirmation instead of a native browser prompt', async () => {
    const result = confirmDialog({
      title: 'Aplicar alterações?',
      message: 'O host será alterado apenas depois da confirmação.',
      tone: 'warning',
      confirmLabel: 'Aplicar',
    })

    const card = document.querySelector<HTMLElement>('.app-dialog-card')
    expect(card?.getAttribute('role')).toBe('alertdialog')
    expect(card?.textContent).toContain('Aplicar alterações?')
    const apply = [...document.querySelectorAll<HTMLButtonElement>('.app-dialog-button')].find((button) => button.textContent === 'Aplicar')
    apply?.click()

    await expect(result).resolves.toBe(true)
    expect(document.querySelector('.app-dialog-backdrop')).toBeNull()
  })

  it('validates prompt input inside the custom modal', async () => {
    const result = promptDialog({
      title: 'Renomear',
      inputLabel: 'Novo nome',
      initialValue: 'old.ts',
      validate: (value) => value.includes('/') ? 'Use apenas o nome.' : undefined,
    })

    const input = document.querySelector<HTMLInputElement>('.app-dialog-field input')!
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('.app-dialog-button')].find((button) => button.textContent === 'Confirmar')!

    input.value = 'nested/file.ts'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    confirm.click()
    expect(document.querySelector('.app-dialog-field-error')?.textContent).toBe('Use apenas o nome.')

    input.value = 'file.ts'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    confirm.click()
    await expect(result).resolves.toBe('file.ts')
  })

  it('preserves multiline evidence and submits it only from the explicit action', async () => {
    const result = promptDialog({ title: 'Evidência', inputLabel: 'Log', multiline: true })
    const input = document.querySelector<HTMLTextAreaElement>('.app-dialog-field textarea')!
    expect(input).toBeTruthy()
    input.value = 'ERROR first line\nfailed to solve'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(document.querySelector('.app-dialog-backdrop')).toBeTruthy()

    const confirm = [...document.querySelectorAll<HTMLButtonElement>('.app-dialog-button')].find((button) => button.textContent === 'Confirmar')!
    confirm.click()
    await expect(result).resolves.toBe('ERROR first line\nfailed to solve')
  })

  it('renders informational notices with a single acknowledgement action', async () => {
    const result = noticeDialog({ title: 'Sessão exportada', message: 'Guarde o ficheiro como segredo.', tone: 'success' })
    expect(document.querySelectorAll('.app-dialog-button')).toHaveLength(1)
    document.querySelector<HTMLButtonElement>('.app-dialog-button')?.click()
    await expect(result).resolves.toBeUndefined()
  })
})
