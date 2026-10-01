import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { INTERNAL_WINDOW_DOCK_ID } from '../../../lib/workspace/layout/internalWindow'
import { InternalWindow } from './InternalWindow'

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

afterEach(() => document.getElementById(INTERNAL_WINDOW_DOCK_ID)?.remove())

describe('InternalWindow', () => {
  it('keeps the workspace interactive and moves minimized windows to the shared dock', () => {
    const close = vi.fn()
    render(<InternalWindow title="Pré-visualização" onClose={close} layerClassName="example-layer">
      <section role="dialog" aria-modal="false" aria-label="Pré-visualização"><header>Pré-visualização</header><label>Rascunho<input aria-label="Rascunho" defaultValue="inicial"/></label></section>
    </InternalWindow>)

    const dialog = screen.getByRole('dialog', { name: 'Pré-visualização' })
    expect(dialog.getAttribute('aria-modal')).toBe('false')
    const layer = document.querySelector('.internal-window-layer')
    expect(layer?.className).toContain('example-layer')
    expect(dialog.querySelector('.internal-window-controls')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Minimizar Pré-visualização' }).closest('[role="dialog"]')).toBe(dialog)
    const draft = screen.getByRole('textbox', { name: 'Rascunho' }) as HTMLInputElement
    fireEvent.change(draft, { target: { value: 'preservado' } })

    fireEvent.click(screen.getByRole('button', { name: 'Minimizar Pré-visualização' }))
    expect(screen.queryByRole('dialog', { name: 'Pré-visualização' })).toBeNull()
    expect(document.getElementById(INTERNAL_WINDOW_DOCK_ID)?.textContent).toContain('Pré-visualização')

    fireEvent.click(screen.getByTitle('Restaurar Pré-visualização'))
    expect(screen.getByRole('dialog', { name: 'Pré-visualização' })).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Rascunho' }) as HTMLInputElement).value).toBe('preservado')

    fireEvent.click(screen.getByRole('button', { name: 'Fechar Pré-visualização' }))
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('keeps the visible layer outside a hidden owner subtree', () => {
    const view = render(<div hidden>
      <InternalWindow title="Janela persistente" onClose={vi.fn()}>
        <section role="dialog" aria-modal="false" aria-label="Janela persistente">Conteúdo</section>
      </InternalWindow>
    </div>)

    const dialog = screen.getByRole('dialog', { name: 'Janela persistente' })
    const layer = dialog.closest('.internal-window-layer')
    expect(layer?.parentElement).toBe(document.body)
    expect(view.container.contains(layer)).toBe(false)
  })

  it('drags the window from its header while keeping it inside the viewport', () => {
    render(<InternalWindow title="Janela móvel" onClose={vi.fn()}>
      <section role="dialog" aria-modal="false" aria-label="Janela móvel"><header>Janela móvel</header><button type="button">Ação</button></section>
    </InternalWindow>)

    const shell = document.querySelector<HTMLElement>('.internal-window-shell')!
    const header = document.querySelector<HTMLElement>('[data-internal-window-drag-handle="true"]:not(.internal-window-drag-grip)')!
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })
    shell.getBoundingClientRect = vi.fn(() => ({
      x: 200, y: 100, left: 200, top: 100, right: 600, bottom: 400, width: 400, height: 300, toJSON: () => ({}),
    } as DOMRect))

    dispatchPointer(header, 'pointerdown', { pointerId: 7, button: 0, clientX: 260, clientY: 120 })
    dispatchPointer(header, 'pointermove', { pointerId: 7, clientX: 360, clientY: 200 })
    expect(shell.style.transform).toBe('translate3d(100px, 80px, 0)')

    dispatchPointer(header, 'pointermove', { pointerId: 7, clientX: 1_200, clientY: 900 })
    expect(shell.style.transform).toBe('translate3d(192px, 192px, 0)')
    dispatchPointer(header, 'pointerup', { pointerId: 7, clientX: 1_200, clientY: 900 })
    expect(shell.hasAttribute('data-internal-window-dragging')).toBe(false)
  })

  it('resizes every internal modal from the shared resize grip', () => {
    render(<InternalWindow title="Janela redimensionável" onClose={vi.fn()}>
      <section role="dialog" aria-modal="false" aria-label="Janela redimensionável"><header>Janela redimensionável</header><div>Conteúdo</div></section>
    </InternalWindow>)

    const shell = document.querySelector<HTMLElement>('.internal-window-shell')!
    const grip = screen.getByRole('separator', { name: 'Redimensionar Janela redimensionável' })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1_200 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    shell.getBoundingClientRect = vi.fn(() => ({
      x: 200, y: 100, left: 200, top: 100, right: 700, bottom: 500, width: 500, height: 400, toJSON: () => ({}),
    } as DOMRect))

    dispatchPointer(grip, 'pointerdown', { pointerId: 9, clientX: 700, clientY: 500 })
    dispatchPointer(grip, 'pointermove', { pointerId: 9, clientX: 880, clientY: 620 })
    expect(shell.style.width).toBe('680px')
    expect(shell.style.height).toBe('520px')
    expect(shell.getAttribute('data-internal-window-sized')).toBe('true')

    dispatchPointer(grip, 'pointerup', { pointerId: 9, clientX: 880, clientY: 620 })
    expect(shell.hasAttribute('data-internal-window-resizing')).toBe(false)
  })

  it('lets opted-in Git-style windows toggle full-screen mode', () => {
    render(<InternalWindow title="Operação Git" onClose={vi.fn()} maximizable>
      <section role="dialog" aria-modal="false" aria-label="Operação Git"><header>Operação Git</header></section>
    </InternalWindow>)

    const shell = document.querySelector<HTMLElement>('.internal-window-shell')!
    fireEvent.click(screen.getByRole('button', { name: 'Maximizar Operação Git' }))
    expect(shell.getAttribute('data-internal-window-maximized')).toBe('true')
    expect(screen.getByRole('button', { name: 'Restaurar Operação Git' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Restaurar Operação Git' }))
    expect(shell.hasAttribute('data-internal-window-maximized')).toBe(false)
  })

  it('keeps close disabled while an operation cannot safely be dismissed', () => {
    render(<InternalWindow title="Operação Git" onClose={vi.fn()} closeDisabled>
      <section role="dialog" aria-modal="false" aria-label="Operação Git">A processar</section>
    </InternalWindow>)
    const close = screen.getByRole('button', { name: 'Fechar Operação Git' }) as HTMLButtonElement
    expect(close.disabled).toBe(true)
  })
})
