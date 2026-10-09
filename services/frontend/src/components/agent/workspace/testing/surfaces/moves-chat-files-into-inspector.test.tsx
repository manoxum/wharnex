import { props } from '../fixtures'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import '../setup'
it('moves chat files into the inspector group immediately before Plano', async () => {
    const rendered = render(props().element)
    const agentAreas = screen.getByRole('tablist', { name: 'Áreas do Agent' })
    const files = screen.getByRole('tab', { name: 'Ficheiros' })
    const plan = screen.getByRole('tab', { name: /^Plano(?: ·|$)/ })

    expect(files.parentElement).toBe(agentAreas)
    expect(files.nextElementSibling).toBe(plan)
    expect(rendered.container.querySelector('.agent-chat-stage .chat-content-tabs')).toBeNull()

    fireEvent.click(files)

    const library = screen.getByRole('region', { name: 'Ficheiros do chat' })
    expect(library.closest('.agent-inspector-stage')).toBeTruthy()
    expect(await screen.findByText('Nenhum ficheiro neste chat')).toBeTruthy()
  })
