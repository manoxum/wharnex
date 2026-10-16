import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ChangeDiffEditor } from '../ChangeDiffEditor'

const mocks = vi.hoisted(() => ({
  createDiffEditor: vi.fn(() => ({ setModel: vi.fn(), getLineChanges: () => [], onDidUpdateDiff: () => ({ dispose() {} }), updateOptions: vi.fn(), dispose() {} })),
}))
vi.mock('../../../../lib/editor/runtime/monaco', () => ({
  activeMonacoTheme: () => 'wharnex-test', configureMonaco: vi.fn(), useMonacoRuntime: () => true,
  monaco: { editor: { createModel: () => ({ dispose() {} }), createDiffEditor: mocks.createDiffEditor } },
}))
vi.mock('../../../../lib/workspace/preferences/uiPreferences', () => ({ subscribeUIPreferences: () => () => {}, workspaceEditorFontSize: () => 14 }))

describe('diff view continuity', () => {
  it('retains the selected inline layout when a different file replaces the Monaco models', async () => {
    const file = { path: 'first.ts', additions: 1, deletions: 1, diff: '--- a/first.ts\n+++ b/first.ts\n@@ -1 +1 @@\n-before\n+after\n' }
    const view = render(<ChangeDiffEditor sessionId="review" fragmentOnly file={file}/>)
    await waitFor(() => expect(mocks.createDiffEditor).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Inline' }))
    view.rerender(<ChangeDiffEditor sessionId="review" fragmentOnly file={{ ...file, path: 'second.ts' }}/>)
    await waitFor(() => expect(mocks.createDiffEditor).toHaveBeenCalledTimes(2))
    expect(mocks.createDiffEditor).toHaveBeenLastCalledWith(expect.any(HTMLElement), expect.objectContaining({ renderSideBySide: false, useInlineViewWhenSpaceIsLimited: false }))
    expect(screen.getByRole('button', { name: 'Inline' }).getAttribute('aria-pressed')).toBe('true')
  })
})
