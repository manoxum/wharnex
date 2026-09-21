import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import type { GitOverview, GitWorkingFile, Session } from '../types'
import { AgentProjectExplorer } from './AgentProjectExplorer'

const session = { id: 'ses_project', project_path: '/work/harness' } as Session


function overview(files: GitWorkingFile[] = []): GitOverview {
  return {
    project_path: '/work/harness', available: true, commit_mode: 'manual', detached: false, has_identity: true,
    current_branch: 'main', branches: [], remotes: [], commits: [], pending: [],
    working: { clean: files.length === 0, stageable_count: files.length, files },
  }
}

describe('AgentProjectExplorer', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps the Explorer toolbar actions and can collapse the expanded tree', async () => {
    vi.spyOn(api, 'listFiles').mockResolvedValue({ files: [
      { path: 'src', name: 'src', kind: 'directory', size: 0 },
      { path: 'src/lib', name: 'lib', kind: 'directory', size: 0 },
      { path: 'src/lib/index.ts', name: 'index.ts', kind: 'file', size: 12 },
    ] })
    vi.spyOn(api, 'gitOverview').mockResolvedValue(overview())

    const { container } = render(<AgentProjectExplorer session={session} onOpen={vi.fn()} onError={vi.fn()} onClose={vi.fn()} />)

    expect(await screen.findByText('Explorer')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Novo ficheiro' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Nova pasta' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Atualizar ficheiros' })).toBeTruthy()
    expect(screen.queryByPlaceholderText('Pesquisar no projeto')).toBeNull()
    expect(container.querySelector('.directory-glyph-source')).toBeTruthy()

    fireEvent.click(screen.getByTitle('src'))
    expect(container.querySelector('.agent-explorer-selection')).toBeNull()
    fireEvent.click(await screen.findByTitle('src/lib'))
    expect(await screen.findByRole('button', { name: 'Abrir src/lib/index.ts' })).toBeTruthy()

    const collapse = screen.getByRole('button', { name: 'Recolher todas as pastas' })
    await waitFor(() => expect(collapse.hasAttribute('disabled')).toBe(false))
    fireEvent.click(collapse)
    expect(screen.queryByRole('button', { name: 'Abrir src/lib/index.ts' })).toBeNull()
    expect(collapse.hasAttribute('disabled')).toBe(true)
  })

  it('surfaces added, modified and deleted Git paths with line deltas', async () => {
    vi.spyOn(api, 'listFiles').mockResolvedValue({ files: [
      { path: 'src', name: 'src', kind: 'directory', size: 0 },
      { path: 'src/app.ts', name: 'app.ts', kind: 'file', size: 12 },
      { path: 'src/new.ts', name: 'new.ts', kind: 'file', size: 8 },
    ] })
    vi.spyOn(api, 'gitOverview').mockResolvedValue(overview([
      { path: 'src/app.ts', kind: 'change', status: 'modified', additions: 4, deletions: 2 },
      { path: 'src/new.ts', kind: 'change', status: 'added', additions: 3, deletions: 0 },
      { path: 'src/removed.ts', kind: 'change', status: 'deleted', additions: 0, deletions: 7 },
    ]))

    const { container } = render(<AgentProjectExplorer session={session} onOpen={vi.fn()} onError={vi.fn()} onClose={vi.fn()} />)

    expect((await screen.findByLabelText('Resumo das alterações Git')).textContent).toContain('3 alterados')
    expect(screen.getByText('Fora da árvore')).toBeTruthy()
    expect(screen.getByText('src/removed.ts')).toBeTruthy()
    fireEvent.click(await screen.findByTitle('src'))

    const modified = screen.getByRole('button', { name: 'Abrir src/app.ts' })
    const added = screen.getByRole('button', { name: 'Abrir src/new.ts' })
    expect(modified.textContent).toContain('M')
    expect(modified.textContent).toContain('+4')
    expect(modified.textContent).toContain('−2')
    expect(added.textContent).toContain('A')
    expect(container.querySelector('.agent-tree-row.git-added')).toBeTruthy()
    expect(container.querySelector('.agent-tree-row.git-virtual')).toBeTruthy()
  })
})
