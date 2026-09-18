import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import type { Session } from '../types'
import { AgentProjectExplorer } from './AgentProjectExplorer'

const session = { id: 'ses_project', project_path: '/work/harness' } as Session

describe('AgentProjectExplorer', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps the Explorer toolbar actions and can collapse the expanded tree', async () => {
    vi.spyOn(api, 'listFiles').mockResolvedValue({ files: [
      { path: 'src', name: 'src', kind: 'directory', size: 0 },
      { path: 'src/lib', name: 'lib', kind: 'directory', size: 0 },
      { path: 'src/lib/index.ts', name: 'index.ts', kind: 'file', size: 12 },
    ] })

    const { container } = render(<AgentProjectExplorer session={session} onOpen={vi.fn()} onError={vi.fn()} onClose={vi.fn()} />)

    expect(await screen.findByText('Explorer')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Novo ficheiro' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Nova pasta' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Atualizar ficheiros' })).toBeTruthy()

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
})
