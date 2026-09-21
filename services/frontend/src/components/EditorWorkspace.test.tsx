import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import type { GitOverview, GitWorkingFile, Session } from '../types'
import { EditorWorkspace } from './EditorWorkspace'

const fileRecordCalls: unknown[] = []
const codeEditorPropsCalls: Array<{ path: string; gitChanges?: unknown[]; runtimeMarkers?: unknown[]; onGitChangeClick?: (change: unknown) => void }> = []
vi.mock('./ChangeDiffEditor', () => ({
  ChangeDiffEditor: (props: { file: unknown }) => { fileRecordCalls.push(props.file); return <div data-testid="change-diff-editor"/> },
}))
vi.mock('./CodeEditor', () => ({
  CodeEditor: (props: { path: string; value: string; onChange: (value: string) => void; onSave: () => void; gitChanges?: unknown[]; runtimeMarkers?: unknown[]; onGitChangeClick?: (change: unknown) => void }) => {
    codeEditorPropsCalls.push(props)
    return <div data-testid="code-editor-stub"><textarea aria-label={`Editor de ${props.path}`} value={props.value} onChange={(event) => props.onChange(event.target.value)}/><button type="button" onClick={props.onSave}>Guardar agora</button></div>
  },
}))
vi.mock('../lib/monaco', () => ({ disposeEditorModel: () => undefined }))

const session = {
  id: 'ses-editor', project_path: '/workspace/demo', state: 'ready', execution_mode: 'protected', automation_mode: 'auto', chat_transport_mode: 'scraper', effort_level: 'high', created_at: '2026-09-12T15:00:00.000Z',
  context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/demo', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
} satisfies Session

function overview(files: GitWorkingFile[] = []): GitOverview {
  return {
    project_path: '/workspace/demo', available: true, commit_mode: 'manual', detached: false, has_identity: true,
    current_branch: 'main', branches: [], remotes: [], tags: [], commits: [], pending: [],
    working: { clean: files.length === 0, stageable_count: files.length, files },
  }
}

// EditorWorkspace stays mounted (CSS-hidden) whenever another mode is
// active. An inline `file={{ ... }}` object literal here got a new identity
// on every one of its many re-renders while a Git diff was open, and
// ChangeDiffEditor tears down and recreates its whole Monaco diff editor
// (plus fresh web workers) whenever its `file` prop's identity changes -
// live-observed ballooning a renderer to several GB and crashing it.
describe('EditorWorkspace git diff stability', () => {
  beforeEach(() => { vi.spyOn(api, 'gitOverview').mockResolvedValue(overview()) })
  afterEach(() => { fileRecordCalls.length = 0; codeEditorPropsCalls.length = 0; localStorage.clear(); vi.restoreAllMocks() })

  it('keeps the same file object across unrelated re-renders while a git diff is open', async () => {
    vi.spyOn(api, 'listFiles').mockResolvedValue({ files: [] })
    vi.spyOn(api, 'readFile').mockResolvedValue({ path: 'a.ts', content: 'const a = 1', sha256: 'abc123', size: 11 })
    vi.spyOn(api, 'gitFileDiff').mockResolvedValue({ path: 'a.ts', diff: '--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-const a = 0\n+const a = 1', truncated: false })
    vi.mocked(api.gitOverview).mockResolvedValue(overview([{ path: 'a.ts', kind: 'change', status: 'modified', additions: 1, deletions: 1 }]))

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

  it('keeps the manual save action icon-only while preserving an accessible label', async () => {
    vi.spyOn(api, 'listFiles').mockResolvedValue({ files: [] })
    vi.spyOn(api, 'readFile').mockResolvedValue({ path: 'a.ts', content: 'const a = 1', sha256: 'abc123', size: 11 })

    const { container } = render(<EditorWorkspace session={session} onError={() => undefined} onRunInTerminal={() => undefined} openPath="a.ts" openNonce={1}/>)
    await screen.findByLabelText('Editor de a.ts')

    const save = container.querySelector<HTMLButtonElement>('.editor-save')
    expect(save?.getAttribute('aria-label')).toBe('Guardar agora')
    expect(save?.textContent).toBe('')
  })

  it('autosaves edited text after a short debounce with optimistic concurrency', async () => {
    vi.spyOn(api, 'listFiles').mockResolvedValue({ files: [] })
    vi.spyOn(api, 'readFile').mockResolvedValue({ path: 'a.ts', content: 'const a = 1', sha256: 'abc123', size: 11 })
    const writeFile = vi.spyOn(api, 'writeFile').mockResolvedValue({ path: 'a.ts', content: 'const a = 2', sha256: 'def456', size: 11 })

    render(<EditorWorkspace session={session} onError={() => undefined} onRunInTerminal={() => undefined} openPath="a.ts" openNonce={1}/>)
    const editor = await screen.findByLabelText('Editor de a.ts')
    fireEvent.change(editor, { target: { value: 'const a = 2' } })

    await waitFor(() => expect(writeFile).toHaveBeenCalledWith('ses-editor', { path: 'a.ts', content: 'const a = 2', sha256: 'abc123' }), { timeout: 1800 })
    await waitFor(() => expect(screen.getByText('Guardado')).toBeTruthy())
  })

  it('passes Compose runtime state to gutter markers for the matching YAML', async () => {
    vi.spyOn(api, 'listFiles').mockResolvedValue({ files: [] })
    vi.spyOn(api, 'readFile').mockResolvedValue({
      path: 'compose.yml',
      content: ['services:', '  backend:', '    image: demo/backend', '  database:', '    image: postgres', '  worker:', '    image: demo/worker'].join('\n'),
      sha256: 'abc123',
      size: 98,
    })
    const dockerOverview = vi.spyOn(api, 'dockerOverview').mockResolvedValue({
      compose_projects: [{
        name: 'demo', container_count: 3, running_count: 1, error_count: 1, stopped_count: 1,
        config_files: ['/workspace/demo/compose.yml'],
        services: [
          { name: 'backend', container_count: 1, running_count: 1, error_count: 0 },
          { name: 'database', container_count: 1, running_count: 0, error_count: 0 },
          { name: 'worker', container_count: 1, running_count: 0, error_count: 1 },
        ],
      }],
      containers: [], images: [], volumes: [], networks: [], refreshed_at: '2026-09-21T07:00:00Z',
    })

    render(<EditorWorkspace session={session} onError={() => undefined} onRunInTerminal={() => undefined} openPath="compose.yml" openNonce={1}/>)

    await waitFor(() => expect(codeEditorPropsCalls.some((props) => (props.runtimeMarkers?.length || 0) === 4)).toBe(true))
    const markers = [...codeEditorPropsCalls].reverse().find((props) => (props.runtimeMarkers?.length || 0) === 4)?.runtimeMarkers
    expect(markers).toEqual([
      { id: 'compose:demo', line: 1, tone: 'error', label: 'Docker Compose demo: Erro' },
      { id: 'compose:demo:backend', line: 2, tone: 'running', label: 'backend: A correr · 1/1 containers' },
      { id: 'compose:demo:database', line: 4, tone: 'stopped', label: 'database: Parado · 0/1 containers' },
      { id: 'compose:demo:worker', line: 6, tone: 'error', label: 'worker: Erro · 0/1 containers · 1 erro' },
    ])
    expect(dockerOverview).toHaveBeenCalledWith('ses-editor')
  })

  it('keeps detached editor surfaces minimal', async () => {
    vi.spyOn(api, 'listFiles').mockResolvedValue({ files: [] })
    vi.spyOn(api, 'readFile').mockResolvedValue({ path: 'src/App.tsx', content: 'export {}', sha256: 'abc123', size: 9 })

    const { container } = render(<EditorWorkspace session={session} onError={() => undefined} onRunInTerminal={() => undefined} openPath="src/App.tsx" openNonce={1} surfaceMode minimalSurface />)
    await waitFor(() => expect(screen.getByTestId('code-editor-stub')).toBeTruthy())

    expect(container.querySelector('.editor-tabbar')).toBeNull()
    expect(container.querySelector('.editor-contextbar')).toBeNull()
    expect(container.querySelector('.editor-statusbar')).toBeNull()
  })

  it('can reveal the active file in the shared project Explorer', async () => {
    vi.spyOn(api, 'listFiles').mockResolvedValue({ files: [] })
    vi.spyOn(api, 'readFile').mockResolvedValue({ path: 'src/App.tsx', content: 'export {}', sha256: 'abc123', size: 9 })
    const onLocateFile = vi.fn()

    render(<EditorWorkspace session={session} onError={() => undefined} onRunInTerminal={() => undefined} openPath="src/App.tsx" openNonce={1} onLocateFile={onLocateFile} />)
    const locate = await screen.findByTitle('Localizar este ficheiro no Explorer')
    fireEvent.click(locate)

    expect(onLocateFile).toHaveBeenCalledWith('src/App.tsx')
  })

  it('closes the recent-run popup on outside press and Escape', async () => {
    vi.spyOn(api, 'listFiles').mockResolvedValue({ files: [] })
    vi.spyOn(api, 'readFile').mockResolvedValue({ path: 'package.json', content: '{\n  "scripts": { "test": "vitest" }\n}', sha256: 'abc123', size: 43 })
    localStorage.setItem('kernl.editor.recent-runs.v1:/workspace/demo', JSON.stringify([{ command: "npm run 'test'", cwd: '.' }]))

    const view = render(<EditorWorkspace session={session} onError={() => undefined} onRunInTerminal={() => undefined} openPath="package.json" openNonce={1}/>)
    await waitFor(() => expect(screen.getByText('Recentes')).toBeTruthy())
    const details = view.container.querySelector<HTMLDetailsElement>('.editor-run-menu')
    if (!details) throw new Error('recent run menu missing')

    fireEvent.click(screen.getByText('Recentes'))
    expect(details.open).toBe(true)
    fireEvent.pointerDown(document.body)
    expect(details.open).toBe(false)

    fireEvent.click(screen.getByText('Recentes'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(details.open).toBe(false)
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


  it('shows the saved Git state in the active tab and editor context', async () => {
    vi.spyOn(api, 'listFiles').mockResolvedValue({ files: [{ path: 'src/App.tsx', name: 'App.tsx', kind: 'file', size: 9 }] })
    vi.spyOn(api, 'readFile').mockResolvedValue({ path: 'src/App.tsx', content: 'export {}', sha256: 'abc123', size: 9 })
    vi.mocked(api.gitOverview).mockResolvedValue(overview([{ path: 'src/App.tsx', kind: 'change', status: 'modified', additions: 5, deletions: 2 }]))
    vi.spyOn(api, 'gitFileDiff').mockResolvedValue({ path: 'src/App.tsx', diff: ['diff --git a/src/App.tsx b/src/App.tsx', '--- a/src/App.tsx', '+++ b/src/App.tsx', '@@ -1 +1 @@', '-export const value = 1', '+export const value = 2', ''].join('\n') })

    const { container } = render(<EditorWorkspace session={session} onError={() => undefined} onRunInTerminal={() => undefined} openPath="src/App.tsx" openNonce={1} />)

    await waitFor(() => expect(container.querySelectorAll('.editor-git-file-state').length).toBeGreaterThanOrEqual(2))
    await waitFor(() => expect(codeEditorPropsCalls.some((props) => (props.gitChanges?.length || 0) === 1)).toBe(true))
    const contextState = container.querySelector('.editor-git-context-state')
    expect(contextState?.textContent).toContain('M')
    expect(contextState?.textContent).toContain('+5')
    expect(contextState?.textContent).toContain('−2')
    expect((screen.getByTitle('Comparar o ficheiro guardado com o Git') as HTMLButtonElement).disabled).toBe(false)
  })
})
