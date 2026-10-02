import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { UITestingDocument } from '../../../types'
import { UITestsTab } from './UITestsTab'

const failedDoc: UITestingDocument = {
  project_id: '/workspace/demo', context_sha256: 'old', sync_status: 'failed', sync_task_id: 'cat_failed',
  sync_error: 'provider response timed out', auto_run_changes: true, environments: [], tests: [], runs: [], guides: [],
}

describe('UITestsTab synchronization failures', () => {
  it('shows the terminal error and re-enables synchronization', () => {
    const onSync = vi.fn()
    render(<UITestsTab doc={failedDoc} busy={false} onSync={onSync} onRun={vi.fn()}/>)

    expect(screen.getByRole('alert').textContent).toContain('provider response timed out')
    const sync = screen.getByRole('button', { name: /Sincronizar/i }) as HTMLButtonElement
    expect(sync.disabled).toBe(false)
    fireEvent.click(sync)
    expect(onSync).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/A descoberta falhou/i).textContent).toContain('tentar novamente')
  })
})
