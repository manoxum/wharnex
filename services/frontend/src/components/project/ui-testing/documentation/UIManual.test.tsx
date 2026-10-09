import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { UITestingDocument } from '../../../../types'
import { UIDocsTab } from './UIDocsTab'

const doc: UITestingDocument = {
  project_id: '/demo', sync_status: 'ready', auto_run_changes: true, runs: [],
  environments: [{ id: 'portal', name: 'Portal', description: 'Portal público', profiles: [] }, { id: 'admin', name: 'Admin', profiles: [] }],
  tests: [
    { id: 'login', title: 'Entrar', goal: 'Entrar', environment_id: 'portal', category: 'smoke', status: 'passed' },
    { id: 'books', title: 'Livros', goal: 'Livros', environment_id: 'portal', category: 'functional', depends_on: ['login'], status: 'failed' },
    { id: 'users', title: 'Utilizadores', goal: 'Gerir', environment_id: 'admin', category: 'functional', status: 'passed' },
  ],
  guides: [
    { id: 'g2', test_id: 'books', run_id: 'run_2', title: 'Submeter um livro', markdown: '## Passo a passo\n\n![Formulário](step-02.png)', pdf_ready: true, updated_at: '' },
    { id: 'g1', test_id: 'login', run_id: 'run_1', title: 'Iniciar sessão', markdown: '## Para que serve\n\nEntrar.', pdf_ready: true, updated_at: '' },
    { id: 'g3', test_id: 'users', run_id: 'run_3', title: 'Gerir utilizadores', markdown: 'Admin', pdf_ready: false, updated_at: '' },
  ],
}

describe('UI Lab manual', () => {
  it('groups guides by environment with an index in reading order and resolved captures', () => {
    render(<UIDocsTab sessionId="ses_1" doc={doc}/>)
    const manual = screen.getByRole('article', { name: 'Manual de Portal' })
    expect(manual.textContent).not.toContain('Gerir utilizadores')
    const index = screen.getByRole('region', { name: 'Índice' }).textContent || ''
    expect(index.indexOf('Iniciar sessão')).toBeLessThan(index.indexOf('Submeter um livro'))
    expect(manual.textContent).toContain('Última execução: Falhou')
    expect(manual.querySelector('img')?.getAttribute('src')).toContain('/ui-testing/assets/run_2/step-02.png')
    fireEvent.click(screen.getByRole('tab', { name: 'Admin' }))
    expect(screen.getByRole('article', { name: 'Manual de Admin' }).textContent).toContain('Gerir utilizadores')
  })
})
