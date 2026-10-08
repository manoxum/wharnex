import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { UITestingDocument } from '../../../../types'
import { UITestsTab } from './UITestsTab'

const syncing: UITestingDocument = {
  project_id: '/workspace/flowcore', sync_status: 'syncing', sync_task_id: 'cat_discovery',
  auto_run_changes: true, environments: [], tests: [], runs: [], guides: [],
}
const props = { busy: false, onSync: vi.fn(), onRun: vi.fn(), onConfigure: vi.fn() }

describe('discovery activity in an empty UI catalog', () => {
  it('shows queueing without claiming that GPT is analyzing the project', () => {
    render(<UITestsTab doc={{ ...syncing, sync_activity: { state: 'queued' } }} {...props}/>)
    expect(screen.getByText('A sincronização está na fila para um Worker.')).toBeTruthy()
    expect(screen.queryByText('A analisar o contexto completo do projeto…')).toBeNull()
    expect((screen.getByRole('button', { name: /Sincronizar/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('names the active Worker only from the durable activity', () => {
    render(<UITestsTab doc={{ ...syncing, sync_activity: { state: 'running', worker: 5 } }} {...props}/>)
    expect(screen.getByText('O Worker 5 está a descobrir os testes de UI do projeto.')).toBeTruthy()
  })

  it('shows the deferred reason and retry time', () => {
    render(<UITestsTab doc={{ ...syncing, sync_activity: { state: 'waiting', reason: 'Limite de upload', not_before: '2026-10-07T13:00:00Z' } }} {...props}/>)
    expect(screen.getByRole('status').textContent).toContain('Limite de upload')
    expect(screen.getByRole('status').textContent).toContain('Nova tentativa a partir de')
    expect(screen.queryByText('A analisar o contexto completo do projeto…')).toBeNull()
  })

  it('does not infer active analysis when talking to an older backend', () => {
    render(<UITestsTab doc={syncing} {...props}/>)
    expect(screen.getByText('A confirmar o estado da sincronização…')).toBeTruthy()
    expect(screen.queryByText('A analisar o contexto completo do projeto…')).toBeNull()
  })

  it('keeps discovery activity visible when a previous catalog exists', () => {
    const doc: UITestingDocument = { ...syncing, sync_activity: { state: 'queued' },
      environments: [{ id: 'web', name: 'Web', url: 'https://app.test', profiles: [] }],
      tests: [{ id: 'home', title: 'Página inicial', goal: 'Abrir', environment_id: 'web', status: 'ready' }] }
    render(<UITestsTab doc={doc} {...props}/>)
    expect(screen.getByRole('status').textContent).toContain('na fila para um Worker')
    expect(screen.getByText('Página inicial')).toBeTruthy()
  })

  it('clears the activity after the catalog is delivered', () => {
    const doc: UITestingDocument = { ...syncing, sync_activity: { state: 'running', worker: 5 } }
    const view = render(<UITestsTab doc={doc} {...props}/>)
    view.rerender(<UITestsTab doc={{ ...doc, sync_status: 'ready' }} {...props}/>)
    expect(screen.queryByRole('status')).toBeNull()
    expect((screen.getByRole('button', { name: /Sincronizar/i }) as HTMLButtonElement).disabled).toBe(false)
  })
})
