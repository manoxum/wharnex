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

  it('keeps long task context readable without horizontal pressure', () => {
    const title = 'Reestruturar o cartão de tarefa com um título suficientemente longo para precisar de duas linhas legíveis'
    const prompt = 'Primeira linha do resumo com contexto útil. Segunda linha com detalhes operacionais. Terceira linha ainda legível. Quarta linha deve ficar limitada pela prévia.'
    const requestId = 'req_20260927T195701_4ea09202f147a886_with_an_extra_long_identifier_segment'
    const metadata = 'Worker: worker-with-an-extraordinarily-long-runtime-identifier-that-must-wrap'
    const view = render(<ProjectTaskCardShell disposition="completed" failed={false} source="orchestrator" sourceLabel="Orchestrator" sourceIcon={<span>AI</span>} stateLabel="Concluída" title={title} updatedAt="2026-09-27T19:57:14Z" updatedLabel="27/09, 19:57" prompt={prompt} rootRequestId={requestId} metadata={<span>{metadata}</span>} renderDetails={() => <div>Detalhes</div>}/>)

    const heading = view.getByText(title)
    const preview = view.getByText(prompt)
    const request = view.getByText(requestId)
    const meta = view.getByText(metadata)
    const header = heading.closest('header')

    expect(header?.className).toContain('grid')
    expect(heading.className).not.toContain('truncate')
    expect(heading.className).toContain('[-webkit-line-clamp:2]')
    expect(heading.className).toContain('[overflow-wrap:anywhere]')
    expect(preview.className).toContain('[-webkit-line-clamp:3]')
    expect(preview.className).toContain('[overflow-wrap:anywhere]')
    expect(request.className).toContain('break-all')
    expect(meta.parentElement?.className).toContain('[&>span]:break-words')
  })

  it('removes the migrated legacy project-task-card selectors', () => {
    expect(legacyCss).not.toMatch(/\.project-task-card(?:[\s.{:#]|$)/)
  })
})
