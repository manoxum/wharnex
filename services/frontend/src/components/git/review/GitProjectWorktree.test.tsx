import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GitOverview } from '../../../types'
import type { GitRepositoryOverviewEntry } from '../../../lib/git/workflow/gitProjectOverview'
import { GitProjectWorktree } from './GitProjectWorktree'

function entry(path: string, label: string, hasIdentity: boolean, files: GitOverview['working']['files']): GitRepositoryOverviewEntry {
  return {
    repository: { path, label, depth: path ? 1 : 0, root: path === '', initialized: true, available: true, detached: false },
    overview: { has_identity: hasIdentity, working: { clean: false, stageable_count: files.length, files } } as GitOverview,
  }
}

function WorktreeHarness({ onOpenDiff = () => undefined }: { onOpenDiff?: (repository: string, path: string) => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  return <GitProjectWorktree
    entries={[
      entry('', 'Superprojeto', true, [
        { path: 'app.go', kind: 'change', status: 'modified' },
        { path: 'module', kind: 'gitlink', status: 'modified' },
      ]),
      entry('packages/locked', 'locked', false, [{ path: 'blocked.ts', kind: 'change', status: 'modified' }]),
    ]}
    disabled={false}
    selected={selected}
    message="feat: commit selected files"
    onMessageChange={() => undefined}
    onToggle={(key) => setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })}
    onCommit={() => undefined}
    onOpenDiff={onOpenDiff}
  />
}

describe('GitProjectWorktree', () => {
  it('selects and clears every committable change with one action', () => {
    render(<WorktreeHarness/>)

    expect(screen.queryByText('Superprojeto')).toBeNull()
    expect(screen.getByText('locked')).toBeTruthy()
    expect((screen.getByRole('checkbox', { name: 'Selecionar app.go em Superprojeto' }) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('checkbox', { name: 'Selecionar module em Superprojeto' }) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('checkbox', { name: 'Selecionar blocked.ts em locked' }) as HTMLInputElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Selecionar todas (2)' }))

    expect((screen.getByRole('checkbox', { name: 'Selecionar app.go em Superprojeto' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Selecionar module em Superprojeto' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByRole('button', { name: 'Commitar (2)' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Limpar seleção' }))

    expect((screen.getByRole('checkbox', { name: 'Selecionar app.go em Superprojeto' }) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('checkbox', { name: 'Selecionar module em Superprojeto' }) as HTMLInputElement).checked).toBe(false)
  })

  it('opens the selected file diff from its row action', () => {
    const onOpenDiff = vi.fn()
    render(<WorktreeHarness onOpenDiff={onOpenDiff}/>)

    const stats = screen.getByRole('button', { name: 'Abrir diff de app.go' })
    expect(stats.className).toContain('min-h-7 min-w-14')
    expect(stats.className).toContain('self-center')
    expect(stats.className).toContain('!text-[calc(7.5px*var(--ui-font-scale))]')
    expect(stats.className).toContain('!leading-none')
    const row = stats.closest('li')
    expect(row?.className).toContain('!items-center')
    expect(row?.className).toContain('!flex')
    const checkbox = screen.getByRole('checkbox', { name: 'Selecionar app.go em Superprojeto' })
    expect(checkbox.className).toContain('!m-0')
    expect(checkbox.className).toContain('!size-4')
    expect(checkbox.parentElement?.className).toContain('!self-center')
    expect(checkbox.parentElement?.className).toContain('!place-items-center')
    expect(screen.getByRole('list').className).toContain('content-start')
    fireEvent.click(stats)

    expect(onOpenDiff).toHaveBeenCalledWith('', 'app.go')
  })

  it('filters by path and selects only visible files', () => {
    render(<WorktreeHarness/>)
    const search = screen.getByRole('searchbox', { name: 'Pesquisar por nome ou caminho…' })
    fireEvent.change(search, { target: { value: 'app.go' } })

    expect(screen.getByText('app.go')).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: 'Selecionar module em Superprojeto' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar visíveis (1)' }))

    expect((screen.getByRole('checkbox', { name: 'Selecionar app.go em Superprojeto' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Limpar pesquisa' }))
    expect((screen.getByRole('checkbox', { name: 'Selecionar module em Superprojeto' }) as HTMLInputElement).checked).toBe(false)
  })
})
