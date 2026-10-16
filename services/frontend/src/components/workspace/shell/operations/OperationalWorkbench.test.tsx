import { useEffect } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../../../../types'
import { OperationalWorkbench } from './OperationalWorkbench'

vi.mock('../../../execution/history/ExecutionErrorsDrawer', () => ({ ExecutionErrorsDrawer: () => <div>Diagnósticos da sessão</div> }))
vi.mock('./OperationalOutput', () => ({ OperationalOutput: () => <div>Histórico durável da sessão</div> }))
afterEach(() => localStorage.removeItem('wharnex.workbench.bottom-tool.v1:/work'))
const session: Session = { id: 'operational', project_path: '/work', state: 'ready', execution_mode: 'protected', automation_mode: 'manual', created_at: '', context: { id: 'context', manifest: { id: 'context', project_root: '/work', sha256: 'fixture', files: [], excluded: [], text_truncated: false } } }

describe('operational workbench lifecycle', () => {
  it('preserves its terminal instance while changing tools and hiding the panel', async () => {
    const mount = vi.fn(), close = vi.fn(), cleanup = vi.fn()
    function Terminal({ active }: { active: boolean }) { useEffect(() => { mount(); return cleanup }, []); return <div data-testid="terminal" data-active={String(active)}/> }
    const props = { session, chats: [], activeChatId: '', events: [], visible: true, height: 275, onHeight: vi.fn(), onOpen: vi.fn(), onClose: close, terminal: (active: boolean) => <Terminal active={active}/> }
    const view = render(<OperationalWorkbench {...props}/>)
    const terminal = screen.getByTestId('terminal')
    fireEvent.click(screen.getByRole('tab', { name: 'Problemas' }))
    await screen.findByText('Diagnósticos da sessão')
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
    expect(screen.getByRole('tab', { name: 'Terminal' }).getAttribute('aria-selected')).toBe('true')
    expect(terminal.getAttribute('data-active')).toBe('true')
    expect(mount).toHaveBeenCalledTimes(1)
  })
})
