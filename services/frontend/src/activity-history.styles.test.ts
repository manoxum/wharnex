import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/styles/domains/activity-history.css'), 'utf8')
const planSurface = readFileSync(resolve(process.cwd(), 'src/components/PlanHistorySurface.tsx'), 'utf8')
const executionSurface = readFileSync(resolve(process.cwd(), 'src/components/ExecutionHistorySurface.tsx'), 'utf8')
function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'))?.[1] || ''
}

describe('durable activity history styling', () => {
  it('makes Main Request execution cards denser and calmer', () => {
    const card = rule('.main-request-block')
    const summary = rule('.main-request-block > .main-request-summary')
    expect(card).toContain('border-radius: 12px')
    expect(summary).toContain('min-height: 58px')
    expect(summary).toContain('grid-template-columns: 30px minmax(0, 1fr) auto')
    expect(css).not.toContain('linear-gradient')
  })

  it('groups metadata separately from export and disclosure icons', () => {
    const controls = rule('.history-action,\n.history-chevron')
    const meta = rule('.main-request-summary-meta,\n.main-request-plan-meta,\n.execution-subtask-meta')
    const actions = rule('.history-summary-actions')
    expect(controls).toContain('width: 26px')
    expect(meta).toContain('display: flex')
    expect(meta).toContain('flex-wrap: nowrap')
    expect(actions).toContain('display: inline-flex')
    expect(actions).toContain('border: 1px solid var(--theme-border-soft)')
    expect(actions).toContain('border-radius: 9px')
    expect(css).toContain('.history-summary-actions .history-action,')
    expect(css).toContain('transform: rotate(90deg)')
    expect(css).toContain('.execution-expand.open { transform: rotate(90deg); }')
  })

  it('uses the same context and action grouping in plans and executions', () => {
    expect(planSurface.match(/history-summary-actions/g)?.length).toBe(2)
    expect(executionSurface.match(/history-summary-actions/g)?.length).toBe(2)
    expect(planSurface.match(/history-summary-context/g)?.length).toBe(2)
    expect(executionSurface.match(/history-summary-context/g)?.length).toBe(2)
  })

  it('keeps the action cluster intact while compacting narrow inspectors', () => {
    expect(css).toContain('.history-summary-context { display: none; }')
    expect(css).toContain('@container request-history (max-width: 460px)')
  })

  it('turns the nested current-plan contract into a compact control strip', () => {
    const surface = rule('.history-current-plan .plan-control-surface')
    const primary = rule('.history-current-plan .plan-control-primary')
    expect(surface).toContain('box-shadow: none')
    expect(primary).toContain('min-height: 52px')
    expect(css).toContain('.history-current-plan .plan-control-copy .panel-kicker')
    expect(css).toContain('display: none')
  })

  it('keeps the nested copy intrinsic before the history breakpoint catches up', () => {
    const copy = rule('.history-current-plan .plan-control-copy')
    const narrow = css.indexOf('@container request-history (max-width: 660px)')
    const reset = css.indexOf('.history-current-plan .plan-control-copy { width: 100%; flex: 0 1 auto; }')
    const tighter = css.indexOf('@container request-history (max-width: 460px)')
    expect(copy).toContain('flex-basis: auto')
    expect(copy).not.toContain('flex-basis: 320px')
    expect(narrow).toBeGreaterThan(-1)
    expect(reset).toBeGreaterThan(narrow)
    expect(reset).toBeLessThan(tighter)
  })
})
