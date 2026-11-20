import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { EditorDocumentsMenu } from './EditorDocumentsMenu'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect
}

it('renders outside the clipped editor strip and opens above a low trigger', () => {
  const onSelect = vi.fn()
  render(<div className="overflow-hidden"><EditorDocumentsMenu documents={[
    { path: 'src/First.tsx', content: '', sha256: '', size: 0 },
    { path: 'src/Current.tsx', content: '', sha256: '', size: 0 },
  ]} activePath="src/Current.tsx" onSelect={onSelect}/></div>)

  const trigger = screen.getByRole('button', { name: /Selecionar ficheiro aberto/ })
  fireEvent.click(trigger)
  const dialog = screen.getByRole('dialog', { name: 'Ficheiros abertos' })
  expect(dialog.className).toContain('w-[min(360px,calc(100vw-16px))]')
  expect(dialog.className).toContain('gap-2')
  expect(dialog.style.scrollbarWidth).toBe('none')
  trigger.getBoundingClientRect = vi.fn(() => rect(700, 700, 32, 32))
  dialog.getBoundingClientRect = vi.fn(() => rect(0, 0, 360, 500))
  Object.defineProperty(dialog, 'scrollHeight', { configurable: true, value: 500 })
  fireEvent(window, new Event('resize'))
  expect(dialog.parentElement).toBe(document.body)
  expect(dialog.className).toContain('fixed')
  expect(dialog.style.left).toBe('372px')
  expect(dialog.style.top).toBe('194px')
  expect(screen.getByTitle('src/Current.tsx').getAttribute('aria-current')).toBe('page')

  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

it('selects an open document and dismisses the list', () => {
  const onSelect = vi.fn()
  render(<EditorDocumentsMenu documents={[
    { path: 'src/First.tsx', content: '', sha256: '', size: 0 },
    { path: 'src/Current.tsx', content: '', sha256: '', size: 0 },
  ]} activePath="src/First.tsx" onSelect={onSelect}/>)
  fireEvent.click(screen.getByRole('button', { name: /Selecionar ficheiro aberto/ }))
  fireEvent.click(screen.getByTitle('src/Current.tsx'))
  expect(onSelect).toHaveBeenCalledWith('src/Current.tsx')
  expect(screen.queryByRole('dialog')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: /Selecionar ficheiro aberto/ }))
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('dialog')).toBeNull()
})
