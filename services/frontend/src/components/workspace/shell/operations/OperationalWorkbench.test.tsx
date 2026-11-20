import { useEffect, useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../../../../types'
import { OperationalWorkbench } from './OperationalWorkbench'
import { selectUtility } from './utilityNavigation'
import { WorkspaceNavigation } from '../navigation/WorkspaceNavigation'

vi.mock('../../../execution/history/ExecutionErrorsDrawer', () => ({ ExecutionErrorsDrawer: () => <div>Sem diagnósticos de código</div> }))
vi.mock('./OperationalOutput', () => ({ OperationalOutput: () => <div>Histórico durável da sessão</div> }))
afterEach(() => {
  localStorage.removeItem('wharnex.workbench.bottom-tool.v1:/work')
  localStorage.removeItem('wharnex.workbench.bottom-expanded.v1:/work')
})
const session: Session = { id: 'operational', project_path: '/work', state: 'ready', execution_mode: 'protected', automation_mode: 'manual', created_at: '', context: { id: 'context', manifest: { id: 'context', project_root: '/work', sha256: 'fixture', files: [], excluded: [], text_truncated: false } } }

describe('operational workbench lifecycle', () => {
  it('preserves its terminal instance while changing tools and hiding the panel', async () => {
    const mount = vi.fn(), close = vi.fn(), cleanup = vi.fn()
    function Terminal({ active }: { active: boolean }) { useEffect(() => { mount(); return cleanup }, []); return <div data-testid="terminal" data-active={String(active)}/> }
    const props = { session, chats: [], activeChatId: '', events: [], visible: true, height: 275, onHeight: vi.fn(), onOpen: vi.fn(), onClose: close, terminal: (active: boolean) => <Terminal active={active}/> }
    const view = render(<OperationalWorkbench {...props}/>)
    const resizeHandle = screen.getByRole('separator', { name: 'Ajustar altura do painel inferior' })
    expect(resizeHandle.className).toContain('cursor-ns-resize')
    expect(resizeHandle.className).not.toContain('whx-accent')
    const terminal = screen.getByTestId('terminal')
    act(() => selectUtility('problems'))
    await screen.findByText('Sem diagnósticos de código')
    expect(terminal.getAttribute('data-active')).toBe('false')
    expect(mount).toHaveBeenCalledTimes(1)
    expect(cleanup).not.toHaveBeenCalled()
    expect(localStorage.getItem('wharnex.workbench.bottom-tool.v1:/work')).toBe('problems')
    fireEvent.click(screen.getByRole('button', { name: 'Recolher ferramentas operacionais' }))
    expect(close).toHaveBeenCalledTimes(1)
    view.rerender(<OperationalWorkbench {...props} visible={false}/>)
    expect(screen.getByTestId('terminal')).toBe(terminal)
    expect(cleanup).not.toHaveBeenCalled()
    view.rerender(<OperationalWorkbench {...props} runRequestId={1}/>)
    expect(screen.getByRole('tabpanel', { name: 'Terminal' })).toBeTruthy()
    expect(terminal.getAttribute('data-active')).toBe('true')
    expect(mount).toHaveBeenCalledTimes(1)
  })

  it('opens the matching terminal, problems and output pane from the vertical tools', async () => {
    function OperationalShell() {
      const [visible, setVisible] = useState(false)
      const terminal = (active: boolean) => <div data-testid="terminal" data-active={String(active)}/>
      return <>
        <WorkspaceNavigation side="left" tools={['terminal', 'problems', 'output']} pinnedTools={[]} drawer="" terminalOpen={visible} pendingCommitCount={0} savedChatCount={0} onToggle={() => undefined} onToggleTerminal={() => setVisible((current) => !current)}/>
        <OperationalWorkbench session={session} chats={[]} activeChatId="" events={[]} visible={visible} height={275} onHeight={() => undefined} onOpen={() => setVisible(true)} onClose={() => setVisible(false)} terminal={terminal}/>
      </>
    }
    render(<OperationalShell/>)

    fireEvent.click(screen.getByRole('button', { name: 'Saída de execução' }))
    expect(await screen.findByText('Histórico durável da sessão')).toBeTruthy()
    expect(document.getElementById('operational-output-pane')?.className).toContain('block')
    expect(document.getElementById('operational-terminal-pane')?.className).toContain('hidden')
    expect(screen.getByRole('button', { name: 'Saída de execução' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Problemas' }))
    expect(await screen.findByText('Sem diagnósticos de código')).toBeTruthy()
    expect(document.getElementById('operational-problems-pane')?.className).toContain('flex')
    expect(document.getElementById('operational-output-pane')?.className).toContain('hidden')

    fireEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }))
    expect(document.getElementById('operational-terminal-pane')?.className).toContain('flex')
    expect(document.getElementById('operational-problems-pane')?.className).toContain('hidden')
    expect(screen.getByRole('button', { name: 'Fechar terminal' }).getAttribute('aria-pressed')).toBe('true')
  })
})
