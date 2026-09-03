import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../types'
import { api } from '../lib/api'
import { InteractiveTerminal } from './InteractiveTerminal'

vi.mock('../lib/api', () => ({
  APIError: class APIError extends Error {},
  api: { terminal: vi.fn(), resetTerminal: vi.fn() },
}))

const session: Session = {
  id: 'ses-terminal', project_path: '/tmp/demo', state: 'ready', execution_mode: 'protected', automation_mode: 'manual', created_at: new Date().toISOString(),
  context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/tmp/demo', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
}

describe('InteractiveTerminal host execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(api.terminal).mockResolvedValue({ argv: ['ls'], cwd: '.', exit_code: 0, stdout: 'README.md\n', stderr: '', duration_ms: 1, success: true })
  })

  it('submits an explicitly confirmed host command with Enter/form semantics', async () => {
    render(<InteractiveTerminal session={session} height={245} onHeight={() => undefined} onError={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Host' }))
    fireEvent.change(screen.getByLabelText('Comando host'), { target: { value: 'ls' } })
    fireEvent.click(screen.getByRole('button', { name: 'Executar comando' }))
    await waitFor(() => expect(api.terminal).toHaveBeenCalledWith('ses-terminal', expect.objectContaining({ argv: ['ls'], cwd: '.' }), 'host', true))
    expect(await screen.findByText('README.md')).toBeTruthy()
  })
})
