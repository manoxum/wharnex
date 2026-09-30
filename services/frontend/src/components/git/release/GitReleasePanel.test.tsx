import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GitBranch } from '../../../types'
import { confirmDialog } from '../../../lib/desktop/bridge/appDialog'
import { GitReleasePanel } from './GitReleasePanel'

vi.mock('../../../lib/desktop/bridge/appDialog', () => ({ confirmDialog: vi.fn() }))

const remoteBranch = { name: 'origin/main', remote: 'origin' } as GitBranch

afterEach(() => {
  vi.clearAllMocks()
  document.getElementById('internal-window-dock')?.remove()
})

describe('GitReleasePanel', () => {
  it('runs publication from the release button and shows the actual failure in the form', async () => {
    vi.mocked(confirmDialog).mockResolvedValue(true)
    const publish = vi.fn().mockResolvedValue({ ok: false, error: 'GitHub authentication is unavailable on the host' })
    render(<GitReleasePanel
      tags={[]} branches={[remoteBranch]} projectVersion="v1.3.21.3" disabled={false}
      onCopyTag={vi.fn()} onGenerateReleaseNotes={vi.fn()} onCreateRelease={publish}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Nova release' }))
    const dialog = await screen.findByRole('dialog', { name: 'Criar nova release' })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Branch remota da release' }), { target: { value: 'origin/main' } })
    const editor = within(dialog).getByRole('textbox', { name: 'Texto manual da release' }) as HTMLDivElement
    editor.innerHTML = '<strong>Release estável</strong>'
    fireEvent.input(editor)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar tag e release' }))

    await waitFor(() => expect(publish).toHaveBeenCalledWith({
      branch: 'origin/main', tag_suffix: '', title: '', body: '<strong>Release estável</strong>',
    }))
    expect((await within(dialog).findByRole('alert')).textContent).toContain('GitHub authentication is unavailable')
  })

  it('keeps GPT release-note generation editable before publishing', async () => {
    const generate = vi.fn().mockResolvedValue('## Novidades\n- Corrige releases')
    render(<GitReleasePanel
      tags={[]} branches={[remoteBranch]} projectVersion="v1.3.21.3" disabled={false}
      onCopyTag={vi.fn()} onGenerateReleaseNotes={generate} onCreateRelease={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Nova release' }))
    const dialog = await screen.findByRole('dialog', { name: 'Criar nova release' })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Branch remota da release' }), { target: { value: 'origin/main' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gerar com GPT' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gerar notas da branch' }))

    await waitFor(() => expect(generate).toHaveBeenCalledWith('origin/main'))
    expect((await within(dialog).findByRole('textbox', { name: 'Notas de release geradas pelo GPT' }) as HTMLTextAreaElement).value).toContain('Corrige releases')
  })
})
