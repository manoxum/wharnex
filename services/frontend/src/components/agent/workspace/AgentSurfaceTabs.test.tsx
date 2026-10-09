import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentSurfaceTabs } from './AgentSurfaceTabs'

afterEach(cleanup)
it('keeps the Chat surface strip icon-only and never selects Chat and an Inspector tab together', () => {
  const onChat = vi.fn(); const onInspector = vi.fn()
  const props = { singlePane: true, inspectorTab: 'terminal' as const, conflict: false, onChat, onInspector,
    attention: () => [], tone: () => undefined, title: (_target: unknown, label: string) => label }
  const { rerender } = render(<AgentSurfaceTabs {...props} chatSelected/>)
  const strip = screen.getByRole('tablist', { name: 'Áreas do Agent' })
  expect(strip.dataset.density).toBe('icons')
  expect(within(strip).getAllByRole('tab', { selected: true })).toEqual([within(strip).getByRole('tab', { name: 'Chat' })])
  expect(within(strip).getByRole('tab', { name: 'Execução' }).getAttribute('aria-selected')).toBe('false')
  fireEvent.click(within(strip).getByRole('tab', { name: 'Execução' }))
  expect(onInspector).toHaveBeenCalledWith('terminal')
  rerender(<AgentSurfaceTabs {...props} chatSelected={false}/>)
  expect(within(strip).getAllByRole('tab', { selected: true })).toEqual([within(strip).getByRole('tab', { name: 'Execução' })])
  fireEvent.click(within(strip).getByRole('tab', { name: 'Chat' }))
  expect(onChat).toHaveBeenCalledOnce()
  rerender(<AgentSurfaceTabs {...props} chatSelected/>)
  expect(within(strip).getAllByRole('tab', { selected: true })).toHaveLength(1)
  expect(strip.dataset.density).toBe('icons')
})
