import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { UITestingDocument } from '../../../../types'
import { UITestsTab } from './UITestsTab'
import { testDuration } from './testDuration'
const doc: UITestingDocument = {
  project_id: '/atlas', sync_status: 'ready', auto_run_changes: false, guides: [],
  environments: [{ id: 'web', name: 'Web', url: 'https://example.test', profiles: [] }],
  tests: [{ id: 'failed', title: 'Abrir editor', goal: 'Ver código', access: 'public', environment_id: 'web', status: 'failed', last_run_id: 'run-1', steps: [{ action: 'Abrir src/app.ts' }] }, { id: 'ok', title: 'Pesquisar', goal: 'Pesquisar', access: 'public', environment_id: 'web', status: 'passed' }],
  runs: [{ id: 'run-1', test_id: 'failed', status: 'failed', started_at: '2026-10-16T10:00:00Z', completed_at: '2026-10-16T10:00:01.250Z', error: 'Editor indisponível' }],
}
it('reruns only failed IDs and keeps duration, failure and strategy available', () => {
  const onRun = vi.fn(); render(<UITestsTab doc={doc} busy={false} onRun={onRun} onSync={vi.fn()} onConfigure={vi.fn()}/>)
  fireEvent.click(screen.getByRole('button', { name: 'Reexecutar falhas' }))
  expect(onRun).toHaveBeenCalledWith(['failed'])
  expect(screen.getByLabelText('Duração 1.3 s')).toBeTruthy()
  expect(screen.getByText('Editor indisponível')).toBeTruthy()
  expect(screen.getByText('Abrir src/app.ts')).toBeTruthy()
})
it('keeps rerun behind the existing configuration boundary', () => {
  render(<UITestsTab doc={{ ...doc, environments: [] }} busy={false} onRun={vi.fn()} onSync={vi.fn()} onConfigure={vi.fn()}/>)
  expect((screen.getByRole('button', { name: 'Reexecutar falhas' }) as HTMLButtonElement).disabled).toBe(true)
})
it('rejects invalid or unfinished timing rather than inventing elapsed time', () => {
  expect(testDuration()).toBe('')
  expect(testDuration({ ...doc.runs[0], completed_at: undefined })).toBe('')
  expect(testDuration({ ...doc.runs[0], completed_at: 'invalid' })).toBe('')
  expect(testDuration({ ...doc.runs[0], completed_at: '2026-10-16T09:00:00Z' })).toBe('')
})
