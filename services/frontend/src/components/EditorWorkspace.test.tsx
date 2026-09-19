import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import type { Session } from '../types'
import { EditorWorkspace } from './EditorWorkspace'

const fileRecordCalls: unknown[] = []
vi.mock('./ChangeDiffEditor', () => ({
  ChangeDiffEditor: (props: { file: unknown }) => { fileRecordCalls.push(props.file); return <div data-testid="change-diff-editor"/> },
}))
vi.mock('./CodeEditor', () => ({ CodeEditor: () => <div data-testid="code-editor-stub"/> }))
vi.mock('../lib/monaco', () => ({ disposeEditorModel: () => undefined }))

const session = {
  id: 'ses-editor', project_path: '/workspace/demo', state: 'ready', execution_mode: 'protected', automation_mode: 'auto', chat_transport_mode: 'scraper', effort_level: 'high', created_at: '2026-09-12T15:00:00.000Z',
  context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/demo', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
} satisfies Session

// EditorWorkspace stays mounted (CSS-hidden) whenever another mode is
// active. An inline `file={{ ... }}` object literal here got a new identity
// on every one of its many re-renders while a Git diff was open, and
// ChangeDiffEditor tears down and recreates its whole Monaco diff editor
// (plus fresh web workers) whenever its `file` prop's identity changes -
// live-observed ballooning a renderer to several GB and crashing it.
describe('EditorWorkspace git diff stability', () => {
  afterEach(() => { fileRecordCalls.length = 0; vi.restoreAllMocks() })

  it('keeps the same file object across unrelated re-renders while a git diff is open', async () => {
    vi.spyOn(api, 'listFiles').mockResolvedValue({ files: [] })
    vi.spyOn(api, 'readFile').mockResolvedValue({ path: 'a.ts', content: 'const a = 1', sha256: 'abc123', size: 11 })
    vi.spyOn(api, 'gitFileDiff').mockResolvedValue({ path: 'a.ts', diff: '--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-const a = 0\n+const a = 1', truncated: false })

    const onError = vi.fn()
    const onRunInTerminal = vi.fn()
    const { rerender } = render(<EditorWorkspace session={session} onError={onError} onRunInTerminal={onRunInTerminal} openPath="a.ts" openNonce={1}/>)

    await waitFor(() => expect((screen.getByTitle('Comparar o ficheiro guardado com o Git') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByTitle('Comparar o ficheiro guardado com o Git'))
    await waitFor(() => expect(screen.getByTestId('change-diff-editor')).toBeTruthy())
    expect(fileRecordCalls).toHaveLength(1)
    const firstFile = fileRecordCalls[0]

    // Re-render with a fresh onRunInTerminal reference, exactly the kind of
    // unrelated parent re-render App.tsx produces constantly - nothing about
    // the diff itself changed.
    act(() => { rerender(<EditorWorkspace session={session} onError={onError} onRunInTerminal={() => undefined} openPath="a.ts" openNonce={1}/>) })

    expect(fileRecordCalls[fileRecordCalls.length - 1]).toBe(firstFile)
  })

  it('offers split and detach actions for the active file', async () => {
    vi.spyOn(api, 'listFiles').mockResolvedValue({ files: [] })
    vi.spyOn(api, 'readFile').mockResolvedValue({ path: 'src/App.tsx', content: 'export {}', sha256: 'abc123', size: 9 })
    const onSplitFile = vi.fn()
    const onDetachFile = vi.fn()

    render(<EditorWorkspace session={session} onError={() => undefined} onRunInTerminal={() => undefined} openPath="src/App.tsx" openNonce={1} onSplitFile={onSplitFile} onDetachFile={onDetachFile} />)
    await waitFor(() => expect(screen.getByTitle('src/App.tsx')).toBeTruthy())

    fireEvent.click(screen.getByLabelText('Dividir editor verticalmente'))
    fireEvent.click(screen.getByLabelText('Dividir editor horizontalmente'))
    fireEvent.click(screen.getByLabelText('Abrir ficheiro numa janela independente'))

    expect(onSplitFile.mock.calls).toEqual([['src/App.tsx', 'vertical'], ['src/App.tsx', 'horizontal']])
    expect(onDetachFile.mock.calls).toEqual([['src/App.tsx']])
  })
})
