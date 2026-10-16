import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { OrchestratorHeader } from './OrchestratorHeader'
it('shares the IDE tab contract without changing section or refresh actions', () => {
  const onSection = vi.fn(), onRefresh = vi.fn()
  render(<OrchestratorHeader section="tasks" count={4} busy={false} onSection={onSection} onRefresh={onRefresh}/>)
  expect(screen.getByRole('tab', { name: /Tasks/ }).getAttribute('aria-selected')).toBe('true')
  fireEvent.click(screen.getByRole('tab', { name: 'Overview' }))
  expect(onSection).toHaveBeenCalledWith('overview')
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar Orchestrator' }))
  expect(onRefresh).toHaveBeenCalledOnce()
})
