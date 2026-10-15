import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChangeSummaryCard } from '../../chat/panel/changePresentation'

vi.mock('../../editor/canvas/ChangeDiffEditor', () => ({ ChangeDiffEditor: () => null }))
afterEach(cleanup)

it('uses the shared diff card and inspector with native labels, version and commit', () => {
  const inspect = vi.fn(), open = vi.fn()
  const file = { path: 'source.ts', additions: 2, deletions: 1, diff: '-old\n+new' }
  render(<ChangeSummaryCard item={{ id: 'native', source: 'codex', role: 'harness', text: 'Finished', presentation: 'change',
    change: { planId: 'req', requestId: 'req', summary: 'commit abc · versão v1.0.0.1', files: [file], appliedAt: '2026-10-15T12:00:00Z', canRevert: false } }} onInspect={inspect} onOpenFile={open}/>)
  expect(screen.getByText('Alterações nativas do Codex')).toBeTruthy()
  expect(screen.queryByText('Alterações aplicadas')).toBeNull()
  expect(screen.getByText('commit abc · versão v1.0.0.1')).toBeTruthy()
  expect(screen.queryByText('Reverter alteração')).toBeNull()
  fireEvent.click(screen.getByTitle('Ver diff'))
  expect(inspect).toHaveBeenCalledWith(file)
  fireEvent.click(screen.getByTitle('Abrir no Editor'))
  expect(open).toHaveBeenCalledWith('source.ts')
})
