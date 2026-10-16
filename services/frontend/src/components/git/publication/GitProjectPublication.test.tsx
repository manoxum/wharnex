import { confirmGitReview, openTab, session } from '../review/testing/fixtures'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../lib/transport/http/api'
import { GitDrawer } from '../review/GitDrawer'
import { states, setupGitChangesScenario } from '../review/changes/testing'

beforeEach(() => {
  setupGitChangesScenario()
  vi.mocked(api.gitContributors).mockResolvedValue({ contributors: [], weeks: [], days: [], total_commits: 0, truncated: false })
})

describe('project-wide push button', () => {
  it('remains reachable from every Git section and publishes all repositories after one review', async () => {
    render(<GitDrawer session={session} busy={false} onClose={() => undefined}/>)
    const button = await screen.findByRole('button', { name: 'Publicar projeto' })
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    const toolbar = screen.getByRole('region', { name: 'Publicação completa do projeto' })
    expect(within(toolbar).getByText(/2 submódulo\(s\) e superprojeto/)).toBeTruthy()
    for (const tab of ['Histórico', 'Contribuidores', 'Branches', 'Definições', 'Alterações'] as const) {
      openTab(tab)
      expect(screen.getByRole('button', { name: 'Publicar projeto' })).toBe(button)
    }
    fireEvent.click(button)
    const review = await screen.findByRole('dialog', { name: 'Push completo do projeto' })
    const repositories = await within(review).findByRole('navigation', { name: 'Repositórios revistos' })
    expect(repositories.textContent).toContain('clean')
    expect(api.gitPush).not.toHaveBeenCalled()
    await confirmGitReview()
    await waitFor(() => expect(api.gitPush).toHaveBeenCalledTimes(3))
    expect(vi.mocked(api.gitPush).mock.calls.map((call) => call[4])).toEqual(['clean', 'module', ''])
    expect(api.commitGitWorktree).not.toHaveBeenCalled()
  })

  it('shows why even a clean submodule blocks complete publication', async () => {
    states.get('clean')!.detached = true
    render(<GitDrawer session={session} busy={false} onClose={() => undefined}/>)
    const reason = await screen.findByText('clean — selecione uma branch antes do push.')
    expect(reason).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Publicar projeto' }) as HTMLButtonElement).disabled).toBe(true)
    expect(api.gitPush).not.toHaveBeenCalled()
  })
})
