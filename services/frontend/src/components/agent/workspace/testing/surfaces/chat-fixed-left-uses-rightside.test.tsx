import { props } from '../fixtures'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import '../setup'
it('keeps the chat fixed on the left and uses the right-side tabs for the inspector', () => {
    const view = props()
    const rendered = render(view.element)
    expect(screen.getByRole('tablist', { name: 'Áreas do Agent' })).toBeTruthy()
    expect(screen.queryByText('Agent Inspector')).toBeNull()
    expect(screen.getByText('Contexto isolado')).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Chat' })).toBeNull()
    const chatSwitcher = screen.getByRole('navigation', { name: 'Conversas do Wharnex' })
    const newChat = screen.getByRole('button', { name: 'Novo chat' })
    expect(newChat.textContent).toBe('')
    expect(newChat.querySelector('svg')).toBeTruthy()
    expect(chatSwitcher.className).toContain('agent-chat-switcher')
    expect(chatSwitcher.closest('.agent-commandbar')).toBeNull()
    expect(rendered.container.querySelector('.agent-chat-stage .chat-panel')).toBeTruthy()
    expect(rendered.container.querySelector('.agent-inspector-stage .inspector-panel')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Redimensionar chat e Engine' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Engine' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ChatGPT' })).toBeTruthy()
    const execute = screen.getByRole('button', { name: 'Aceitar e executar' })
    fireEvent.click(execute)
    expect(view.onExecute).toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByRole('tab', { name: /^Plano(?: ·|$)/ }))
    expect(screen.getByText('Atualizar UI')).toBeTruthy()
  })
