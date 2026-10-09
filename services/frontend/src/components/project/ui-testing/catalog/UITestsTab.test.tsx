import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { UITestingDocument } from '../../../../types'
import { UITestsTab } from './UITestsTab'

const failedDoc: UITestingDocument = {
  project_id: '/workspace/demo', context_sha256: 'old', sync_status: 'failed', sync_task_id: 'cat_failed',
  sync_error: 'provider response timed out', auto_run_changes: true, environments: [], tests: [], runs: [], guides: [],
}

const unconfiguredDoc: UITestingDocument = {
  project_id: '/workspace/demo', context_sha256: 'current', sync_status: 'ready',
  auto_run_changes: true,
  environments: [{ id: 'workspace', name: 'Wharnex workspace', profiles: [] }],
  tests: [{ id: 'open-workspace', title: 'Abrir workspace', goal: 'Abrir o workspace', environment_id: 'workspace', status: 'ready' }],
  runs: [], guides: [],
}

describe('UITestsTab synchronization failures', () => {
  it('shows the terminal error and re-enables synchronization', () => {
    const onSync = vi.fn()
    render(<UITestsTab doc={failedDoc} busy={false} onSync={onSync} onRun={vi.fn()} onConfigure={vi.fn()}/>)

    expect(screen.getByRole('alert').textContent).toContain('provider response timed out')
    const sync = screen.getByRole('button', { name: /Sincronizar/i }) as HTMLButtonElement
    expect(sync.disabled).toBe(false)
    fireEvent.click(sync)
    expect(onSync).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/A descoberta falhou/i).textContent).toContain('tentar novamente')
  })

  it('blocks tests whose environment URL is missing and opens configuration', () => {
    const onRun = vi.fn()
    const onConfigure = vi.fn()
    render(<UITestsTab doc={unconfiguredDoc} busy={false} onSync={vi.fn()} onRun={onRun} onConfigure={onConfigure}/>)

    expect(screen.getByRole('alert').textContent).toContain('Wharnex workspace')
    expect(screen.getByRole('alert').textContent).toContain('URL')
    expect((screen.getByRole('button', { name: /Executar todos/i }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /Abrir workspace/i }))
    expect((screen.getByRole('button', { name: /Executar selecionados/i }) as HTMLButtonElement).disabled).toBe(true)
    expect(onRun).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Configurar ambiente/i }))
    expect(onConfigure).toHaveBeenCalledTimes(1)
  })

  it('blocks a test whose required profile has no credentials', () => {
    const doc: UITestingDocument = {
      ...unconfiguredDoc,
      environments: [{ id: 'workspace', name: 'Wharnex workspace', url: 'http://127.0.0.1:6969', profiles: [{ id: 'admin', label: 'Administrador', role: 'admin', configured: false }] }],
      tests: [{ ...unconfiguredDoc.tests[0], profile_id: 'admin' }],
    }
    render(<UITestsTab doc={doc} busy={false} onSync={vi.fn()} onRun={vi.fn()} onConfigure={vi.fn()}/>)

    expect(screen.getByRole('alert').textContent).toContain('Administrador')
    expect((screen.getByRole('button', { name: /Executar todos/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('runs tests when their environment and profile are configured', () => {
    const onRun = vi.fn()
    const doc: UITestingDocument = {
      ...unconfiguredDoc,
      environments: [{ id: 'workspace', name: 'Wharnex workspace', url: 'http://127.0.0.1:6969', profiles: [{ id: 'admin', label: 'Administrador', role: 'admin', configured: true }] }],
      tests: [{ ...unconfiguredDoc.tests[0], profile_id: 'admin' }],
    }
    render(<UITestsTab doc={doc} busy={false} onSync={vi.fn()} onRun={onRun} onConfigure={vi.fn()}/>)

    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Executar todos/i }))
    expect(onRun).toHaveBeenCalledWith([])
  })
})

describe('UITestsTab catalog presentation', () => {
  const groupedDoc: UITestingDocument = {
    project_id: '/workspace/demo', sync_status: 'ready', auto_run_changes: true, runs: [], guides: [],
    environments: [
      { id: 'web', name: 'Aplicação web', url: 'https://app.test', profiles: [{ id: 'admin', label: 'Administrador', role: 'admin', configured: true }] },
      { id: 'site', name: 'Site público', url: 'https://site.test', profiles: [] },
    ],
    tests: [
      { id: 'login', title: 'Entrar', goal: 'Entrar', environment_id: 'web', profile_id: 'admin', access: 'authenticated', status: 'passed' },
      { id: 'landing', title: 'Página inicial', goal: 'Abrir', environment_id: 'site', access: 'public', status: 'ready' },
      { id: 'create-item', title: 'Criar item', goal: 'Criar', environment_id: 'web', access: 'authenticated', depends_on: ['login'], source: 'user', status: 'ready',
        steps: [{ action: 'Abrir /items/new', expected: 'Formulário visível' }], expected_result: 'Item listado' },
    ],
    sessions: [{ id: 'uts_1', environment_id: 'web', test_id: 'login', profile_id: 'admin', covers: ['login'], valid: true, captured_at: '2026-10-02T10:00:00Z', expires_at: '2026-10-02T22:00:00Z' }],
    designs: [{ task_id: 'cat_1', brief: 'Testar exportação', status: 'designing', created_at: '', updated_at: '' }],
  }

  it('groups tests by environment and explains access, dependencies and sessions', () => {
    render(<UITestsTab doc={groupedDoc} busy={false} onSync={vi.fn()} onRun={vi.fn()} onConfigure={vi.fn()} onNew={vi.fn()}/>)
    const web = screen.getByRole('region', { name: 'Ambiente Aplicação web' })
    const site = screen.getByRole('region', { name: 'Ambiente Site público' })
    expect(web.textContent).toContain('Criar item')
    expect(web.textContent).not.toContain('Página inicial')
    expect(site.textContent).toContain('Público')
    expect(web.textContent).toContain('depende de: Entrar')
    expect(web.textContent).toContain('Perfil: Administrador (herdado)')
    expect(web.textContent).toContain('sessão guardada')
    expect(web.textContent).toContain('Abrir /items/new')
    expect(screen.getByRole('list', { name: 'Pedidos de novos testes' }).textContent).toContain('GPT a desenhar')
  })

  it('opens the new-test composer', () => {
    const onNew = vi.fn()
    render(<UITestsTab doc={groupedDoc} busy={false} onSync={vi.fn()} onRun={vi.fn()} onConfigure={vi.fn()} onNew={onNew}/>)
    fireEvent.click(screen.getByRole('button', { name: /Novo/ }))
    expect(onNew).toHaveBeenCalledTimes(1)
  })
})

it('filters the catalog while keeping an explicitly selected test selected', () => {
  const onRun = vi.fn()
  const doc: UITestingDocument = {
    ...unconfiguredDoc,
    environments: [{ id: 'workspace', name: 'Web', url: 'https://app.test', profiles: [] }],
    tests: [
      { ...unconfiguredDoc.tests[0], title: 'Entrar', status: 'queued', access: 'public' },
      { ...unconfiguredDoc.tests[0], id: 'search', title: 'Pesquisar livro', status: 'failed', access: 'public' },
    ],
  }
  render(<UITestsTab doc={doc} busy={false} onSync={vi.fn()} onRun={onRun} onConfigure={vi.fn()}/>)
  fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Entrar' }))
  fireEvent.change(screen.getByRole('searchbox', { name: 'Pesquisar testes' }), { target: { value: 'livro' } })
  expect(screen.queryByRole('checkbox', { name: 'Selecionar Entrar' })).toBeNull()
  expect(screen.getByRole('checkbox', { name: 'Selecionar Pesquisar livro' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Executar selecionados/ }))
  expect(onRun).toHaveBeenCalledWith(['open-workspace'])
  fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por estado' }), { target: { value: 'passed' } })
  expect(screen.getByText(/Nenhum teste corresponde/)).toBeTruthy()
})

it('does not execute selections removed by a refreshed catalog', () => {
  const onRun = vi.fn()
  const doc = { ...unconfiguredDoc, environments: [{ id: 'workspace', name: 'Web', url: 'https://app.test', profiles: [] }] }
  const props = { busy: false, onRun, onSync: vi.fn(), onConfigure: vi.fn() }
  const view = render(<UITestsTab doc={doc} {...props}/>)
  fireEvent.click(screen.getByRole('checkbox', { name: /Selecionar Abrir workspace/ }))
  view.rerender(<UITestsTab doc={{ ...doc, tests: [] }} {...props}/>)
  expect((screen.getByRole('button', { name: /Executar selecionados/ }) as HTMLButtonElement).disabled).toBe(true)
  expect(onRun).not.toHaveBeenCalled()
})
