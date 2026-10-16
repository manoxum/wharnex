import { useRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { useToolWindowMaximize } from './useToolWindowMaximize'

function Example({ tool = 'git' as const, project = '/atlas' }) {
  const root = useRef<HTMLElement>(null)
  const window = useToolWindowMaximize(root, tool, project)
  return <div className="workspace-main-row" data-testid="row"><aside ref={root} data-maximized={window.maximized}><button onClick={window.toggle}>Maximizar</button><input aria-label="Rascunho" defaultValue="Mensagem"/><div role="dialog"><button>Diálogo</button></div></aside></div>
}
it('maximizes reversibly without remounting content and lets a dialog own Escape', () => {
  render(<Example/>); const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: 'Rascunho preservado' } })
  fireEvent.click(screen.getByText('Maximizar'))
  expect(screen.getByTestId('row').dataset.toolMaximized).toBe('git')
  fireEvent.keyDown(screen.getByText('Diálogo'), { key: 'Escape' })
  expect(screen.getByTestId('row').dataset.toolMaximized).toBe('git')
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(screen.getByTestId('row').hasAttribute('data-tool-maximized')).toBe(false)
  expect(screen.getByRole('textbox')).toBe(input)
  expect((input as HTMLInputElement).value).toBe('Rascunho preservado')
})
it('retires temporary maximization when the owning project changes', () => {
  const view = render(<Example/>); fireEvent.click(screen.getByText('Maximizar'))
  view.rerender(<Example project="/other"/>); expect(screen.getByTestId('row').hasAttribute('data-tool-maximized')).toBe(false)
  view.rerender(<Example/>); expect(screen.getByTestId('row').hasAttribute('data-tool-maximized')).toBe(false)
})
