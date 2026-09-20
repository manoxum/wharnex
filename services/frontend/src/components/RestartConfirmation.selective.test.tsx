import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RestartConfirmation } from './RestartConfirmation'

describe('RestartConfirmation selective activation', () => {
  it('reloads only the frontend when the built batch changed only frontend files', () => {
    const onActivate = vi.fn()
    render(<RestartConfirmation
      sessionId="ses-self"
      impacts={['frontend']}
      busy={false}
      onLater={vi.fn()}
      onActivate={onActivate}
    />)

    expect(screen.queryByText(/fechar todas/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /recarregar frontend agora/i }))
    expect(onActivate).toHaveBeenCalledWith(['frontend'])
  })

  it('restarts only changed runtime services and names them before confirmation', () => {
    const onActivate = vi.fn()
    render(<RestartConfirmation
      sessionId="ses-self"
      impacts={['backend', 'frontend']}
      busy={false}
      onLater={vi.fn()}
      onActivate={onActivate}
    />)

    expect(screen.getByText(/backend/i)).toBeTruthy()
    expect(screen.getByText(/frontend/i)).toBeTruthy()
    expect(screen.queryByText(/desktop/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /aplicar agora/i }))
    expect(onActivate).toHaveBeenCalledWith(['backend', 'frontend'])
  })

  it('offers a Desktop restart only when Desktop itself changed', () => {
    render(<RestartConfirmation
      sessionId="ses-self"
      impacts={['desktop']}
      busy={false}
      onLater={vi.fn()}
      onActivate={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: /reiniciar desktop agora/i })).toBeTruthy()
  })
})
