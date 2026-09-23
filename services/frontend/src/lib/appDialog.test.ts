import { afterEach, describe, expect, it, vi } from 'vitest'
import { confirmDialog, noticeDialog, promptDialog } from './appDialog'
import { INTERNAL_WINDOW_DOCK_ID } from './internalWindow'

function dispatchPointer(target: HTMLElement, type: 'pointerdown' | 'pointermove' | 'pointerup', init: { pointerId: number; clientX: number; clientY: number; button?: number }) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: init.button ?? 0,
    clientX: init.clientX,
    clientY: init.clientY,
  })
  Object.defineProperty(event, 'pointerId', { value: init.pointerId })
  Object.defineProperty(event, 'isPrimary', { value: true })
  target.dispatchEvent(event)
}

afterEach(() => {
  document.querySelectorAll('.app-dialog-backdrop').forEach((element) => element.remove())
  document.documentElement.classList.remove('app-dialog-open')
  document.getElementById(INTERNAL_WINDOW_DOCK_ID)?.remove()
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
    expect(card?.getAttribute('aria-modal')).toBe('false')
    expect(document.querySelector('.app-dialog-backdrop')?.getAttribute('data-chatgpt-overlay-blocker')).toBe('true')
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
  it('adds an attached drag grip to imperative application dialogs', async () => {
    const result = confirmDialog({ title: 'Mover confirmação', message: 'A janela continua interativa.' })
    const shell = document.querySelector<HTMLElement>('.internal-window-shell')!
    const grip = document.querySelector<HTMLElement>('.internal-window-drag-grip')!
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 })
    shell.getBoundingClientRect = vi.fn(() => ({
      x: 250, y: 150, left: 250, top: 150, right: 650, bottom: 450, width: 400, height: 300, toJSON: () => ({}),
    } as DOMRect))

    dispatchPointer(grip, 'pointerdown', { pointerId: 3, button: 0, clientX: 300, clientY: 170 })
    dispatchPointer(grip, 'pointermove', { pointerId: 3, clientX: 340, clientY: 210 })
    const transform = shell.style.transform
    dispatchPointer(grip, 'pointerup', { pointerId: 3, clientX: 340, clientY: 210 })

    const cancel = [...document.querySelectorAll<HTMLButtonElement>('.app-dialog-button')].find((button) => button.textContent === 'Cancelar')!
    cancel.click()
    await expect(result).resolves.toBe(false)
    expect(transform).toBe('translate3d(40px, 40px, 0)')
  })

  it('minimizes to the shared lower-right dock without resolving the dialog', async () => {
    const result = confirmDialog({ title: 'Revisão', message: 'Continuar depois.' })
    const minimize = document.querySelector<HTMLButtonElement>('[aria-label="Minimizar Revisão"]')!
    minimize.click()

    expect(document.querySelector('.app-dialog-backdrop')?.classList.contains('is-minimized')).toBe(true)
    expect(document.querySelector('.app-dialog-backdrop')?.hasAttribute('data-chatgpt-overlay-blocker')).toBe(false)
    expect(document.getElementById(INTERNAL_WINDOW_DOCK_ID)?.textContent).toContain('Revisão')

    document.querySelector<HTMLButtonElement>('[title="Restaurar Revisão"]')?.click()
    expect(document.querySelector('.app-dialog-backdrop')?.classList.contains('is-minimized')).toBe(false)
    expect(document.querySelector('.app-dialog-backdrop')?.getAttribute('data-chatgpt-overlay-blocker')).toBe('true')

    const cancel = [...document.querySelectorAll<HTMLButtonElement>('.app-dialog-button')].find((button) => button.textContent === 'Cancelar')!
    cancel.click()
    await expect(result).resolves.toBe(false)
  })

})
