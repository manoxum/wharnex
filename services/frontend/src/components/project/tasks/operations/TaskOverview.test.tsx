import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TaskOverview } from './TaskOverview'

describe('TaskOverview', () => {
  it('keeps search and source filters in an adaptive, named control group', () => {
    render(<TaskOverview counts={{ queue: 0, completed: 0 }} runningCount={0} attentionCount={0} query="" source="all" onQuery={vi.fn()} onSource={vi.fn()} onClose={vi.fn()}/>)

    const group = screen.getByRole('group', { name: 'Pesquisa e origem das tarefas' })
    expect(group.className).toContain('auto-fit')
    expect(group.className).toContain('minmax(min(100%,11rem),1fr)')
    expect(screen.getByRole('textbox', { name: 'Pesquisar tarefas' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Filtrar tarefas por origem' })).toBeTruthy()
  })
})
