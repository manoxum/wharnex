import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmptyState } from '../../presentation/workbench'
import { ProjectTaskListPanel } from './ProjectTaskListPanel'

describe('ProjectTaskListPanel', () => {
  it('centers an empty task state while preserving top alignment for populated lists', () => {
    const empty = render(<ProjectTaskListPanel><EmptyState title="Nenhuma tarefa" description="Ainda não há trabalho nesta vista."/></ProjectTaskListPanel>)
    const emptyPanel = screen.getByRole('tabpanel')

    expect(emptyPanel.className).toContain('has-[>[data-empty-state]]:not-has-[>article]:content-center')
    expect(emptyPanel.querySelector('[data-empty-state]')).toBeTruthy()
    empty.unmount()

    render(<ProjectTaskListPanel><article>Tarefa carregada</article></ProjectTaskListPanel>)
    const populatedPanel = screen.getByRole('tabpanel')
    expect(populatedPanel.className).toContain('content-start')
    expect(populatedPanel.querySelector('[data-empty-state]')).toBeNull()
  })
})
