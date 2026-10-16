import diffReviewSource from '../../../components/git/review/presentation/DiffReviewFrame.tsx?raw'
import operationSurface from '../../../components/git/review/operations/operationSurface.ts?raw'
import operationProgress from '../../../components/git/review/operations/GitOperationProgress.tsx?raw'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { css, lastRule, firstRule } from '../../cascade/styleRules'
import { tabBarSource } from '../../cascade/tabStyles'

describe('Git workbench CSS', () => {
  it('uses project theme tokens instead of the old green-tinted dark island', () => {
    const drawer = lastRule('.git-drawer')
    const section = lastRule('.git-section')
    const tabs = tabBarSource

    expect(drawer).toContain('background: var(--theme-bg)')
    expect(drawer).toContain('color: var(--theme-text)')
    expect(section).toContain('background: var(--theme-surface)')
    expect(section).toContain('border: 1px solid var(--theme-border-soft)')
    expect(tabs).toContain('bg-whx-surface')
    expect(tabs).not.toContain('#1b1e19')
    expect(section).not.toContain('#1a1d18')
  })

  it('keeps Git tabs fully visible and increases the working-copy reading density', () => {
    const tabs = tabBarSource
    const gitTabs = readFileSync(resolve(process.cwd(), 'src/components/git/review/GitTabs.tsx'), 'utf8')
    const projectTree = readFileSync(resolve(process.cwd(), 'src/components/agent/explorer/ProjectExplorerTree.tsx'), 'utf8')
    const pendingCommit = lastRule('.git-unpushed-list li')
    expect(gitTabs).toContain('label="Secções do Git"')
    expect(gitTabs.match(/id: '(?:changes|history|contributors|branches|settings)'/g)).toHaveLength(5)
    expect(tabs).toContain('overflow-x-auto')
    expect(gitTabs).toContain('label="Tipos de alterações locais"')
    expect(gitTabs.match(/id: '(?:working|pending)'/g)).toHaveLength(2)
    expect(tabs).not.toContain('overflow-hidden')
    expect(pendingCommit).toContain('min-height: 52px')
    expect(projectTree).toContain('h-[28px]')
  })

  it('gives Git mutations a modal processing surface with visible progress', () => {
    expect(lastRule('.project-git-operation-layer')).toContain('position: fixed')
    expect(lastRule('.project-git-operation-layer')).toContain('inset: 0')
    expect(operationSurface).toContain('grid-cols-[48px_minmax(0,1fr)]')
    expect(operationSurface).toContain('border-whx-border bg-whx-elevated')
    expect(operationProgress).toContain('h-1.5 min-w-0 flex-1 overflow-hidden')
    expect(operationProgress).toContain('animate-pulse motion-reduce:animate-none')
    expect(operationProgress).toContain('aria-label="Progresso da operação"')
    expect(operationProgress).toContain('aria-live="polite"')
  })

  it('lets generic Git diff windows use the viewport width and keeps the worktree file rail visible', () => {
    const modal = lastRule('.git-diff-modal')
    const worktreeReview = firstRule('.git-worktree-diff-review')

    expect(modal).toContain('width: min(1680px, calc(100vw - clamp(16px, 4vw, 48px)))')
    expect(worktreeReview).toContain('grid-template-columns: minmax(240px, 24%) minmax(0, 1fr)')
  })

  it('gives branch-history commit diffs a dedicated review hierarchy', () => {
    const modal = firstRule('.git-history-commit-modal')
    const header = firstRule('.git-history-commit-modal > .git-history-commit-header')
    const heading = firstRule('.git-history-commit-modal > .git-history-commit-header > .git-history-commit-heading')
    const actions = firstRule('.git-history-commit-modal > .git-history-commit-header > .git-history-commit-actions')
    const stats = firstRule('.git-history-commit-stats')
    const activeFile = diffReviewSource

    expect(modal).toContain('width: min(1680px, calc(100vw - 32px))')
    expect(modal).toContain('border-radius: 16px')
    expect(header).toContain('min-height: 78px')
    expect(header).toContain('linear-gradient')
    expect(heading).toContain('display: flex')
    expect(actions).toContain('display: flex')
    expect(stats).toContain('grid-template-columns: repeat(3, minmax(54px, auto))')
    expect(activeFile).toContain('aria-pressed={file.id === selected.id}')
    expect(activeFile).toContain("file.id === selected.id ? 'active !bg-whx-hover !text-whx-text'")
  })

  it('keeps history rows graph-first and compact', () => {
    const row = lastRule('.git-history-row')
    const compactRow = lastRule('.git-drawer .git-history-row')
    const graph = lastRule('.git-commit-graph')
    const compactGraph = lastRule('.git-drawer .git-commit-graph')
    const graphLines = lastRule('.git-commit-graph-lines')
    const historyTail = lastRule('.git-history-tail')
    const compactTail = lastRule('.git-drawer .git-history-tail')
    expect(row).toContain('grid-template-columns: auto minmax(0, 1fr) auto')
    expect(compactRow).toContain('grid-template-columns: auto minmax(0, 1fr)')
    expect(graph).toContain('min-height: 38px')
    expect(graph).toContain('height: auto')
    expect(compactGraph).toContain('grid-row: 1 / span 2')
    expect(graphLines).toContain('height: 100%')
    expect(historyTail).toContain('display: inline-flex')
    expect(compactTail).toContain('grid-column: 2')
    expect(css).toContain('--git-lane-0: #5e9cff')
    expect(css).toContain('.git-graph-node')
  })
})
