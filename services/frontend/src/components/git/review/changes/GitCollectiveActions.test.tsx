import { states, setupGitChangesScenario } from './testing'
import { session, openChangesTab, openTab } from '../testing/fixtures'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { api } from '../../../../lib/transport/http/api'
import { GitDrawer } from '../GitDrawer'

beforeEach(setupGitChangesScenario)

async function renderPending() {
  render(<GitDrawer session={session} busy={false} onClose={() => undefined}/>)
  const input = await screen.findByRole('textbox', { name: 'Mensagem do commit' })
  fireEvent.change(input, { target: { value: 'fix: projeto completo' } })
}

describe('collective actions in pending changes', () => {
  it('hides clean submodules in changes, retains them in the complete inventory and filters pending commits', async () => {
    await renderPending()
    fireEvent.click(screen.getByRole('button', { name: /Executar operações em/ }))
    expect(screen.queryByText('clean')).toBeNull()
    expect(within(screen.getByLabelText('Repositórios do projeto')).getByText('module')).toBeTruthy()
    openChangesTab('Commits pendentes')
    await waitFor(() => expect(api.gitUnpushed).toHaveBeenCalledWith(session.id, 'module'))
    expect(api.gitUnpushed).not.toHaveBeenCalledWith(session.id, 'clean')
    openTab('Branches')
    expect(screen.getByText('clean')).toBeTruthy()
  })

  it('blocks collective mutations with actionable identity and remote reasons', async () => {
    states.get('')!.has_identity = false
    states.get('module')!.remotes = []
    states.get('module')!.branches[0].upstream = undefined
    await renderPending()
    expect((screen.getByRole('button', { name: 'Commitar tudo' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Commit e push' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/Superprojeto: configure user.name e user.email/)).toBeTruthy()
    expect(screen.getByText(/module: configure um remoto/)).toBeTruthy()
    expect(api.commitGitWorktree).not.toHaveBeenCalled()
  })
})
