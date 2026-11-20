import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GitDiffReview } from './GitDiffReview'

vi.mock('../../editor/canvas/ChangeDiffEditor', () => ({ ChangeDiffEditor: ({ file }: { file: { path: string } }) => <div data-testid="diff-editor">{file.path}</div> }))

describe('GitDiffReview', () => {
  it('keeps the file list vertically scrollable and lets the sidebar collapse and expand', () => {
    render(<GitDiffReview sessionId="session" emptyText="Sem diff" files={[
      { path: 'src/one.ts', additions: 4, deletions: 1, diff: 'diff --git a/src/one.ts b/src/one.ts\n' },
      { path: 'src/two.ts', additions: 2, deletions: 3, diff: 'diff --git a/src/two.ts b/src/two.ts\n' },
    ]}/>)

    const review = screen.getByTestId('diff-editor').closest('.git-diff-review') as HTMLElement
    expect(review.querySelector('.git-diff-review-file-list')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Recolher lista de ficheiros' }).getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Recolher lista de ficheiros' }))
    expect(review.classList.contains('files-collapsed')).toBe(true)
    expect(review.querySelector('.git-diff-review-file-list')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Expandir lista de ficheiros' }))
    expect(review.classList.contains('files-collapsed')).toBe(false)
    expect(review.querySelector('.git-diff-review-file-list')).not.toBeNull()
  })

  it('keeps the filename and parent path visible in long diff entries', () => {
    const path = 'services/frontend/src/lib/attention/center/attentionHistory.test.ts'
    render(<GitDiffReview sessionId="session" emptyText="Sem diff" files={[
      { path, additions: 4, deletions: 1, diff: '' },
      { path: 'src/other.ts', additions: 1, deletions: 0, diff: '' },
    ]}/>)

    const file = screen.getByRole('button', { name: path })
    expect(within(file).getByText('attentionHistory.test.ts')).toBeTruthy()
    expect(within(file).getByText('…/attention/center')).toBeTruthy()
  })
})
