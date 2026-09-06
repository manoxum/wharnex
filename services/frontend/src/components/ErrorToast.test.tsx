import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saveUIPreferences } from '../lib/uiPreferences'
import { ErrorToast } from './ErrorToast'

describe('ErrorToast', () => {
  beforeEach(() => {
    localStorage.clear()
    saveUIPreferences({ uiFont: 'elegant', monoFont: 'jetbrains', scale: 1, theme: 'system', errorPopups: true })
  })

  it('shows a compact non-blocking summary and links to the chat instead of rendering the long error', () => {
    const onShowInChat = vi.fn()
    const onDismiss = vi.fn()
    const { container } = render(<ErrorToast open onDismiss={onDismiss} onShowInChat={onShowInChat} />)
    expect(screen.getByText('Ocorreu um erro')).toBeTruthy()
    expect(screen.getByText('Os detalhes foram adicionados ao chat.')).toBeTruthy()
    expect(container.querySelector('[data-chatgpt-overlay-blocker]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ver erro no chat' }))
    expect(onShowInChat).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Fechar aviso de erro' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('respects the preference that disables error popups', () => {
    saveUIPreferences({ uiFont: 'elegant', monoFont: 'jetbrains', scale: 1, theme: 'system', errorPopups: false })
    const { container } = render(<ErrorToast open onDismiss={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the actionable backend error when one is available', () => {
    const { container } = render(<ErrorToast open message="another request is already pending" onDismiss={() => {}} />)
    expect(container.textContent).toContain('another request is already pending')
  })
})
