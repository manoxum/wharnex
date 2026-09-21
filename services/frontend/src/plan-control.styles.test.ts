import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/plan-control.css'), 'utf8')
const legacy = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')

function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'))?.[1] || ''
}

describe('plan control surface CSS', () => {
  it('uses a calm layered hierarchy for the execution contract', () => {
    const surface = rule('.plan-control-surface')
    const primary = rule('.plan-control-primary')
    const actions = rule('.plan-decision-actions')

    expect(surface).toContain('border-radius: 16px')
    expect(surface).toContain('background: color-mix')
    expect(surface).toContain('var(--theme-surface)')
    expect(primary).toContain('border-radius: 12px')
    expect(primary).toContain('background: var(--theme-elevated)')
    expect(actions).toContain('border-radius: 10px')
    expect(actions).toContain('var(--theme-subtle)')
  })

  it('keeps auxiliary controls card-like and readable', () => {
    const tools = rule('.plan-manual-tools')
    const mark = rule('.plan-manual-mark')

    expect(tools).toContain('border: 1px solid var(--theme-border-soft)')
    expect(tools).toContain('border-radius: 11px')
    expect(mark).toContain('background: var(--theme-elevated)')
    expect(mark).toContain('border-radius: 9px')
  })

  it('reflows from the inspector width instead of the viewport', () => {
    expect(rule('.plan-view')).toContain('container-type: inline-size')
    expect(css).toContain('@container plan-view (max-width: 760px)')
    expect(css).toContain('@container plan-view (max-width: 480px)')
    expect(css).toContain('.plan-decision-actions > button { flex: 1 1 132px; }')
  })


  it('gives plan headers and metrics a compact card hierarchy', () => {
    const heading = rule('.plan-heading')
    const metrics = rule('.plan-metrics')

    expect(heading).toContain('border-radius: 14px')
    expect(heading).toContain('background: color-mix')
    expect(metrics).toContain('gap: 7px')
    expect(metrics).toContain('background: transparent !important')
  })

  it('styles Main Request and subplan summaries as nested disclosure cards', () => {
    const history = rule('.main-request-history')
    const summary = rule('.main-request-block > .main-request-summary')
    const subplan = rule('.main-request-plan-row')

    expect(history).toContain('container-type: inline-size')
    expect(summary).toContain('grid-template-columns: 36px minmax(0, 1fr) auto')
    expect(subplan).toContain('border-radius: 11px')
    expect(css).toContain('@container request-history (max-width: 660px)')
  })

  it('presents execution subtasks as expandable cards instead of a flat stream', () => {
    const list = rule('.execution-subtask-list')
    const card = rule('.execution-subtask')
    const summary = rule('.execution-subtask > .execution-subtask-summary')

    expect(list).toContain('display: grid')
    expect(card).toContain('border-radius: 11px')
    expect(summary).toContain('grid-template-columns: 30px minmax(0, 1fr) auto')
    expect(css).toContain('.execution-subtask[open] > .execution-subtask-summary')
    expect(css).not.toContain('linear-gradient')
  })

  it('keeps the extracted control styling out of the legacy stylesheet', () => {
    expect(legacy).not.toContain('.plan-control-surface {')
    expect(legacy).not.toContain('.plan-control-primary {')
    expect(legacy).not.toContain('.plan-manual-tools {')
  })
})
