import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { GitOverview } from '../types'
import type { GitRepositoryOverviewEntry } from '../lib/gitProjectOverview'
import { GitProjectWorktree } from './GitProjectWorktree'

function entry(path: string, label: string, hasIdentity: boolean, files: GitOverview['working']['files']): GitRepositoryOverviewEntry {
  return {
    repository: { path, label, depth: path ? 1 : 0, root: path === '', initialized: true, available: true, detached: false },
    overview: { has_identity: hasIdentity, working: { clean: false, stageable_count: files.length, files } } as GitOverview,
  }
}

function WorktreeHarness() {
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
    onOpenDiff={() => undefined}
  />
}

describe('GitProjectWorktree', () => {
  it('selects and clears every committable change with one action', () => {
    render(<WorktreeHarness/>)

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
})
