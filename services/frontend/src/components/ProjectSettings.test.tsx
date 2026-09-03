import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../types'
import { api } from '../lib/api'
import { ProjectSettings } from './ProjectSettings'

vi.mock('../lib/api', () => ({
  api: {
    projectConfig: vi.fn(),
    contextInspection: vi.fn(),
    refreshContext: vi.fn(),
    updateProjectConfig: vi.fn(),
  },
}))

const session: Session = {
  id: 'ses-config',
  project_path: '/tmp/demo',
  state: 'ready',
  execution_mode: 'protected',
  automation_mode: 'manual',
  created_at: new Date().toISOString(),
  context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/tmp/demo', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
}

describe('ProjectSettings loading', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.contextInspection).mockResolvedValue({
      snapshot_id: 'ctx', sha256: 'abc', project_root: '/tmp/demo', included_files: 0, excluded_items: 0, included_bytes: 0, roots: [], entries: [], rules: [],
    })
  })

  it('shows an actionable retry state instead of remaining stuck on loading', async () => {
    vi.mocked(api.projectConfig).mockRejectedValueOnce(new Error('open whaness.yml: no such file or directory')).mockResolvedValueOnce({
      version: 1,
      project: { name: 'demo' },
      context: { auto_exclude: true, max_file_bytes: 2097152, include: [], exclude: [] },
    })
    render(<ProjectSettings session={session} onClose={() => undefined} onSession={() => undefined} onError={() => undefined} />)

    expect(screen.getByText('A carregar configuração…')).toBeTruthy()
    expect(await screen.findByText('Não foi possível carregar a configuração')).toBeTruthy()
    expect(screen.queryByText('A carregar configuração…')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Tentar novamente/i }))
    await waitFor(() => expect(screen.getByText('Reconhecimento automático')).toBeTruthy())
    expect(api.projectConfig).toHaveBeenCalledTimes(2)
  })
})
