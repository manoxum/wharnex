import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import { WorkspaceShell } from './WorkspaceShell'

describe('WorkspaceShell project actions', () => {
  afterEach(() => vi.restoreAllMocks())

  it('closes the project actions menu with Escape or a click outside it', async () => {
    vi.spyOn(api, 'config').mockResolvedValue({ planner: 'openai', sandbox: 'docker', model: 'test', api_configured: true, chatgpt_web_embed: false })
    render(<WorkspaceShell />)

    const trigger = await screen.findByRole('button', { name: 'Ações de projeto' })
    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
