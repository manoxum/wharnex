import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../../../types'

const mocks = vi.hoisted(() => ({ loadMonaco: vi.fn() }))

vi.mock('../../../lib/editor/runtime/monaco', () => ({ loadMonaco: mocks.loadMonaco }))
vi.mock('./EditorWorkspace', () => ({
  EditorWorkspace: () => <div data-testid="editor-workspace">Editor pronto</div>,
}))

import { DeferredEditorWorkspace } from './DeferredEditorWorkspace'

describe('DeferredEditorWorkspace', () => {
  beforeEach(() => mocks.loadMonaco.mockReset())

  it('adianta Monaco até o editor ser pedido e preserva a superfície depois da primeira ativação', async () => {
    let releaseRuntime = () => {}
    mocks.loadMonaco.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseRuntime = resolve }))
    const session = { id: 'session-1', project_path: '/tmp/project' } as Session
    const common = { session, onError: vi.fn(), onRunInTerminal: vi.fn() }
    const view = render(<DeferredEditorWorkspace {...common} active={false}/>)

    expect(mocks.loadMonaco).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('A carregar editor')).toBeNull()

    view.rerender(<DeferredEditorWorkspace {...common} active/>)
    await waitFor(() => expect(mocks.loadMonaco).toHaveBeenCalledTimes(1))
    expect(screen.getByLabelText('A carregar editor')).toBeTruthy()

    releaseRuntime()
    await waitFor(() => expect(screen.getByTestId('editor-workspace')).toBeTruthy())

    view.rerender(<DeferredEditorWorkspace {...common} active={false}/>)
    expect(screen.getByTestId('editor-workspace')).toBeTruthy()
  })
})
