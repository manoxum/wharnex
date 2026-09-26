import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChangeDiffEditor } from './ChangeDiffEditor'

const mocks = vi.hoisted(() => {
  const diffEditor = {
    setModel: vi.fn(),
    getLineChanges: vi.fn(() => []),
    onDidUpdateDiff: vi.fn(() => ({ dispose: vi.fn() })),
    updateOptions: vi.fn(),
    getModifiedEditor: vi.fn(() => ({ revealLineInCenter: vi.fn() })),
    dispose: vi.fn(),
  }
  return {
    useMonacoRuntime: vi.fn(() => true),
    createModel: vi.fn<(content: string, language: string) => { dispose: () => void }>(() => ({ dispose: vi.fn() })),
    createDiffEditor: vi.fn<(host: HTMLElement, options: Record<string, unknown>) => typeof diffEditor>(() => diffEditor),
    diffEditor,
  }
})

vi.mock('../lib/api', () => ({ api: { readFile: vi.fn(() => new Promise(() => undefined)) } }))
vi.mock('../lib/uiPreferences', () => ({
  subscribeUIPreferences: vi.fn(() => vi.fn()),
  workspaceEditorFontSize: vi.fn(() => 14),
}))
vi.mock('../lib/monaco', () => ({
  activeMonacoTheme: vi.fn(() => 'wharness-dark'),
  configureMonaco: vi.fn(),
  useMonacoRuntime: mocks.useMonacoRuntime,
  monaco: { editor: { setTheme: vi.fn(), createModel: mocks.createModel, createDiffEditor: mocks.createDiffEditor } },
}))

describe('ChangeDiffEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useMonacoRuntime.mockReturnValue(true)
    mocks.diffEditor.getLineChanges.mockReturnValue([])
  })

  // A Git diff opened from the explorer is reachable without the editor
  // workspace ever having been activated, so it can be the first surface in
  // the app that needs Monaco. It must wait for the runtime instead of
  // dereferencing it while still undefined.
  it('waits for the Monaco runtime instead of touching it unloaded', () => {
    mocks.useMonacoRuntime.mockReturnValue(false)

    render(<ChangeDiffEditor sessionId="ses-self" file={{
      path: 'src/demo.ts',
      additions: 1,
      deletions: 1,
      diff: 'diff --git a/src/demo.ts b/src/demo.ts\n--- a/src/demo.ts\n+++ b/src/demo.ts\n@@ -1 +1 @@\n-old\n+new\n',
    }}/>)

    expect(screen.getByLabelText('A carregar editor')).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Comparação antes e depois' })).toBeNull()
  })

  it('keeps before and after context visible while the comparison loads', () => {
    render(<ChangeDiffEditor sessionId="ses-self" file={{
      path: 'src/demo.ts',
      additions: 1,
      deletions: 1,
      diff: 'diff --git a/src/demo.ts b/src/demo.ts\n--- a/src/demo.ts\n+++ b/src/demo.ts\n@@ -1 +1 @@\n-old\n+new\n',
    }}/>)

    const legend = screen.getByRole('group', { name: 'Comparação antes e depois' })
    expect(legend.textContent).toContain('Antes')
    expect(legend.textContent).toContain('Versão anterior')
    expect(legend.textContent).toContain('Depois')
    expect(legend.textContent).toContain('Versão aplicada')
    expect(screen.getByText('A preparar comparação…')).toBeTruthy()
  })

  it('keeps the requested side-by-side layout in narrow diff surfaces', async () => {
    render(<ChangeDiffEditor sessionId="ses-self" fragmentOnly file={{
      path: 'src/demo.ts',
      additions: 1,
      deletions: 1,
      diff: 'diff --git a/src/demo.ts b/src/demo.ts\n--- a/src/demo.ts\n+++ b/src/demo.ts\n@@ -1 +1 @@\n-old\n+new\n',
    }}/>)

    await waitFor(() => expect(mocks.createDiffEditor).toHaveBeenCalledTimes(1))
    expect(mocks.createDiffEditor.mock.calls[0]?.[1]).toMatchObject({
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: false,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Inline' }))
    expect(mocks.diffEditor.updateOptions).toHaveBeenLastCalledWith({
      renderSideBySide: false,
      useInlineViewWhenSpaceIsLimited: false,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Lado a lado' }))
    expect(mocks.diffEditor.updateOptions).toHaveBeenLastCalledWith({
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: false,
    })
  })
})
