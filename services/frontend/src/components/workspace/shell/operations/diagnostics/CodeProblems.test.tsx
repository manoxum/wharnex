import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { CodeProblems } from './CodeProblems'
it('separates code diagnostics, filters by source/path and navigates with a structured location', () => {
  const navigate = vi.fn()
  window.addEventListener('wharnex:open-code-problem', navigate)
  render(<CodeProblems problems={[
    { path: 'src/a.ts', line: 3, column: 2, message: 'Tipo incompatível', source: 'TypeScript', error: true },
    { path: 'src/b.ts', line: 5, column: 1, message: 'Import não utilizado', source: 'Lint', error: false },
  ]}/>)
  expect(screen.getByText('1 erros · 1 avisos')).toBeTruthy()
  fireEvent.change(screen.getByRole('textbox', { name: 'Filtrar problemas' }), { target: { value: 'TypeScript' } })
  expect(screen.queryByText('Import não utilizado')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Tipo incompatível/ }))
  expect(navigate.mock.calls[0][0].detail).toMatchObject({ path: 'src/a.ts', line: 3, column: 2 })
  window.removeEventListener('wharnex:open-code-problem', navigate)
})

it('keeps an empty diagnostics surface compact and free of explanatory copy', () => {
  render(<CodeProblems problems={[]}/>)
  expect(screen.getByRole('status').textContent).toBe('Sem diagnósticos de código')
  expect(screen.queryByText(/incident|runtime/i)).toBeNull()
})
