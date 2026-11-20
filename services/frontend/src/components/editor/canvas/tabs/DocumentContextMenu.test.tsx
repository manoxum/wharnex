import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { EditorTabs } from '../EditorTabs'
it('opens the clicked document menu, copies both paths, pins, reveals and closes by scope', () => {
  const close = vi.fn(), select = vi.fn(), pin = vi.fn(), locate = vi.fn(), reopen = vi.fn(), copy = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } })
  render(<EditorTabs documents={['a.ts', 'b.ts'].map((path) => ({ path, content: '', draft: '', size: 0, sha256: '' }))} activePath="a.ts" savingPaths={new Set()} gitByPath={new Map()} projectPath="/work" onSelect={select} onClose={vi.fn()} onSave={async () => true} onCloseScope={close} onTogglePin={pin} onLocate={locate} onReopen={reopen}/>)
  const open = () => fireEvent.contextMenu(screen.getByRole('tab', { name: 'b.ts' }), { clientX: 100, clientY: 100 })
  for (const [label, scope] of [['Fechar atual', 'current'], ['Fechar outros', 'others'], ['Fechar todos', 'all'], ['Fechar separadores à direita', 'right']]) {
    open(); fireEvent.click(screen.getByRole('menuitem', { name: label })); expect(close).toHaveBeenLastCalledWith('b.ts', scope)
  }
  open(); fireEvent.click(screen.getByRole('menuitem', { name: 'Copiar caminho do ficheiro' })); expect(copy).toHaveBeenLastCalledWith('/work/b.ts')
  open(); fireEvent.click(screen.getByRole('menuitem', { name: 'Copiar caminho relativo' })); expect(copy).toHaveBeenLastCalledWith('b.ts')
  open(); fireEvent.click(screen.getByRole('menuitem', { name: 'Fixar separador' })); expect(pin).toHaveBeenCalledWith('b.ts')
  open(); fireEvent.click(screen.getByRole('menuitem', { name: 'Revelar no explorador de ficheiros' })); expect(locate).toHaveBeenCalledWith('b.ts')
  open(); fireEvent.click(screen.getByRole('menuitem', { name: 'Reabrir último separador fechado' })); expect(reopen).toHaveBeenCalled()
  expect(select).not.toHaveBeenCalled()
  fireEvent(screen.getByRole('tab', { name: 'b.ts' }), new MouseEvent('auxclick', { button: 1, bubbles: true }))
})
