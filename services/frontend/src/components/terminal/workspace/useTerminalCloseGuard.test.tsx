import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../lib/transport/http/api'
import { useTerminalCloseGuard } from './useTerminalCloseGuard'

const closeTerminal = vi.spyOn(api, 'closeTerminal').mockResolvedValue(undefined)
const projectPath = '/tmp/project'

function Harness({ closeProject }: { closeProject: (projectPath: string) => Promise<void> }) {
  const source = window
  const frames = useRef(new Map([[projectPath, { contentWindow: source } as unknown as HTMLIFrameElement]]))
  const guard = useTerminalCloseGuard(frames, [projectPath], closeProject, () => undefined)
  return <><button onClick={() => guard.requestProjectClose(projectPath)}>Fechar projeto</button>{guard.dialog}</>
}

function publishRunningTerminal() {
  fireEvent(window, new MessageEvent('message', {
    origin: window.location.origin,
    source: window,
    data: { type: 'wharness:terminal-runtime', projectPath, terminals: [{ sessionID: 'ses-one', terminalID: 'pty_one', status: 'connected' }] },
  }))
}

describe('useTerminalCloseGuard', () => {
  beforeEach(() => closeTerminal.mockClear())

  it('keeps a live Host PTY in background when the project closes', async () => {
    const closeProject = vi.fn(async () => undefined)
    render(<Harness closeProject={closeProject} />)
    publishRunningTerminal()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar projeto' }))
    expect(screen.getByRole('alertdialog').textContent).toContain('Há 1 processo em execução')
    fireEvent.click(screen.getByRole('button', { name: /Manter em background/ }))
    await waitFor(() => expect(closeProject).toHaveBeenCalledWith(projectPath))
    expect(closeTerminal).not.toHaveBeenCalled()
  })

  it('closes the live PTY before unbinding the project when requested', async () => {
    const closeProject = vi.fn(async () => undefined)
    render(<Harness closeProject={closeProject} />)
    publishRunningTerminal()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar projeto' }))
    fireEvent.click(screen.getByRole('button', { name: /Encerrar processos de terminal/ }))
    await waitFor(() => expect(closeTerminal).toHaveBeenCalledWith('ses-one', 'pty_one'))
    await waitFor(() => expect(closeProject).toHaveBeenCalledWith(projectPath))
  })
})
