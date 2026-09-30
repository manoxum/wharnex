import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Status } from './OrchestratorStatus'
import { readStyleSource } from '../../../styles/cascade/readStyleSource'

const legacyCss = readStyleSource('styles/legacy/styles.css')
const tailwindCss = readFileSync(resolve(process.cwd(), 'src/styles/theme/tailwind.css'), 'utf8')
const domains: Record<string, string> = { OrchestratorWorkspace: 'workspace', OrchestratorOverview: 'overview', OrchestratorPlanningQueue: 'planning', OrchestratorTasks: 'tasks', OrchestratorTaskDrawer: 'tasks' }
const source = (file: string) => readFileSync(resolve(process.cwd(), `src/components/orchestrator/${domains[file.replace('.tsx', '')]}/${file}`), 'utf8')

function orchestratorLegacyCss() {
  const start = legacyCss.indexOf('/* Orchestrator workspace */')
  const end = legacyCss.indexOf('/* Compact, polished transcript presentation', start)
  return legacyCss.slice(start, end)
}

describe('Orchestrator typography migration', () => {
  it('keeps the tracked visual baseline available for review evidence', () => {
    expect(existsSync(resolve(process.cwd(), '../../docs/orchestrator-test/kanban-before.png'))).toBe(true)
  })

  it('keeps Tailwind typography tokens attached to the persisted UI scale', () => {
    expect(tailwindCss).toContain('--text-sm: calc(9px * var(--ui-font-scale));')
    expect(tailwindCss).toContain('--text-base: calc(11px * var(--ui-font-scale));')
    expect(tailwindCss).toContain('--text-lg: calc(14px * var(--ui-font-scale));')
    expect(tailwindCss).toContain('--text-2xl: calc(22px * var(--ui-font-scale));')
  })

  it('removes legacy Orchestrator font sizing from the migrated surface', () => {
    const css = orchestratorLegacyCss()
    expect(css).not.toContain('font-size:')
    expect(css).not.toMatch(/font:\s*calc\(/)
    expect(css).not.toContain('var(--ui-font-scale)')
    expect(css).not.toContain('.orchestrator-header nav button {')
    expect(css).not.toContain('.orchestrator-drawer > header span {')
    expect(css).not.toContain('.orchestrator-goal-copy h1 {')
  })

  it('uses readable Tailwind hierarchy across the operational surfaces', () => {
    const workspace = source('OrchestratorWorkspace.tsx')
    const overview = source('OrchestratorOverview.tsx')
    const queue = source('OrchestratorPlanningQueue.tsx')
    const tasks = source('OrchestratorTasks.tsx')
    const drawer = source('OrchestratorTaskDrawer.tsx')

    expect(workspace).toContain('text-base')
    expect(overview).toContain('text-2xl')
    expect(queue).toContain('text-base')
    expect(tasks).toContain('text-lg')
    expect(drawer).toContain('text-lg')
    expect([workspace, overview, queue, tasks, drawer].join('\n')).not.toContain('text-[calc(')
  })

  it('keeps status names visible while state colors come from theme tokens', () => {
    const { container, rerender } = render(<Status status="WAITING" />)
    let badge = container.querySelector('span')
    expect(badge?.textContent).toBe('Espera')
    expect(badge?.className).toContain('text-sm')
    expect(badge?.className).toContain('var(--theme-warning)')

    rerender(<Status status="FAILED" />)
    badge = container.querySelector('span')
    expect(badge?.textContent).toBe('FAILED')
    expect(badge?.className).toContain('var(--theme-danger)')
  })
})
