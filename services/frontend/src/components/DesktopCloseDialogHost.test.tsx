import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DesktopCloseDialogHost } from './DesktopCloseDialogHost'

type Prompt = { projectPath: string; projectName: string; hasProject: boolean }

let publishPrompt: (payload: Prompt) => void = () => {}
const resolveClose = vi.fn(async (action: string) => ({ ok: true, action }))
const acknowledgeClose = vi.fn(async () => ({ ok: true }))

beforeEach(() => {
  resolveClose.mockClear()
  acknowledgeClose.mockClear()
  Object.defineProperty(window, 'wharnessDesktop', {
    configurable: true,
    value: {
      windows: {
        onCloseConfirmation: (callback: (payload: Prompt) => void) => { publishPrompt = callback; return () => {} },
        acknowledgeClose,
        resolveClose,
      },
    },
  })
})

afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'wharnessDesktop', { configurable: true, value: undefined })
})

async function openDialog() {
  render(<DesktopCloseDialogHost />)
  act(() => publishPrompt({ projectPath: '/workspace/alpha', projectName: 'alpha', hasProject: true }))
  expect(screen.getByRole('alertdialog').textContent).toContain('O que deseja fazer com alpha?')
}

describe('DesktopCloseDialogHost', () => {
  it('renders a themed application modal that blocks native ChatGPT surfaces', async () => {
    await openDialog()
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.parentElement?.getAttribute('data-chatgpt-overlay-blocker')).toBe('true')
    expect(dialog.textContent).toContain('Continuar em background')
    expect(dialog.textContent).toContain('Fechar projeto atual')
    expect(dialog.textContent).toContain('Guardar sessão e sair')
  })

  it.each([
    ['Continuar em background', 'background'],
    ['Fechar projeto atual', 'close-project'],
    ['Guardar sessão e sair', 'close-all'],
    ['Cancelar', 'cancel'],
  ])('sends %s through the trusted close channel', async (label, action) => {
    await openDialog()
    fireEvent.click(screen.getByRole('button', { name: label }))
    await waitFor(() => expect(resolveClose).toHaveBeenCalledWith(action))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('reports that it is on screen so the native fallback prompt stands down', async () => {
    await openDialog()
    await waitFor(() => expect(acknowledgeClose).toHaveBeenCalledTimes(1))
    // The decision stays open afterwards: acknowledging is not answering.
    expect(resolveClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeTruthy()
  })

  it('maps Escape to cancel instead of closing outside the authoritative path', async () => {
    await openDialog()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(resolveClose).toHaveBeenCalledWith('cancel'))
  })
})
