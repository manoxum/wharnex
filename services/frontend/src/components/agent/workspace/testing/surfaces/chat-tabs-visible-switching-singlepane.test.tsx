import { props } from '../fixtures'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import '../setup'
it('keeps chat tabs visible while switching single-pane Agent surfaces', () => {
    const view = props()
    const rendered = render(<view.Harness singlePane />)
    const areas = screen.getByRole('tablist', { name: 'Áreas do Agent' })
    const chat = within(areas).getByRole('tab', { name: 'Chat' })

    expect(rendered.container.querySelector('.agent-workspace.single-pane')).toBeTruthy()
    expect(chat.getAttribute('aria-selected')).toBe('true')
    expect(within(areas).getAllByRole('tab', { selected: true })).toHaveLength(1)
    expect(rendered.container.querySelector('.agent-inspector-stage.surface-hidden')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Redimensionar chat e Engine' })).toBeNull()
    const chatSwitcher = screen.getByRole('navigation', { name: 'Conversas do Wharnex' })
    expect(chatSwitcher.className).not.toContain('surface-hidden')

    fireEvent.click(within(areas).getByRole('tab', { name: 'Engine' }))
    expect(rendered.container.querySelector('.agent-chat-stage.surface-hidden')).toBeTruthy()
    expect(rendered.container.querySelector('.agent-inspector-stage.surface-hidden')).toBeNull()
    expect(chatSwitcher.className).not.toContain('surface-hidden')
    expect(within(chatSwitcher).getByRole('tab', { name: /^Principal$/ })).toBeTruthy()

    expect(within(areas).getAllByRole('tab', { selected: true })).toHaveLength(1)
    expect(chat.getAttribute('aria-selected')).toBe('false')
    fireEvent.click(within(areas).getByRole('tab', { name: 'Plano' }))
    expect(chatSwitcher.className).not.toContain('surface-hidden')
    expect(within(chatSwitcher).getByRole('tab', { name: /^Principal$/ })).toBeTruthy()
    fireEvent.click(chat)
    expect(within(areas).getAllByRole('tab', { selected: true })).toHaveLength(1)
    expect(chat.getAttribute('aria-selected')).toBe('true')
  })
