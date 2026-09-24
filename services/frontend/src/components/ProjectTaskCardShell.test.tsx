import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import legacyCss from '../styles/legacy/styles.css?raw'
import { ProjectTaskCardShell } from './ProjectTaskCardShell'

describe('ProjectTaskCardShell', () => {
  it('uses the Tailwind card surface and exposes status hierarchy', () => {
    const view = render(<ProjectTaskCardShell disposition="queue" failed={false} source="chat" sourceLabel="Chat" sourceIcon={<span>AI</span>} stateLabel="Na fila" title="Melhorar cartões" updatedAt="2026-09-24T19:00:00Z" updatedLabel="24/09, 19:00" prompt="Resumo legível da tarefa" rootRequestId="req_123" metadata={<span>2 requisições GPT</span>} renderDetails={() => <div>Detalhes</div>}/>)
    const card = view.container.querySelector('[data-project-task-card]')

    expect(card?.className).toContain('rounded-xl')
    expect(card?.className).toContain('border-whx-border-soft')
    expect(view.getByText('Na fila').className).toContain('text-whx-warning')
    expect(view.getByText('Resumo legível da tarefa').className).toContain('bg-whx-bg')
  })

  it('removes the migrated legacy project-task-card selectors', () => {
    expect(legacyCss).not.toMatch(/\.project-task-card(?:[\s.{:#]|$)/)
  })
})
