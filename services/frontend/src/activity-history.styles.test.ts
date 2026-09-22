import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/activity-history.css'), 'utf8')
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

  it('gives export and disclosure controls separate compact affordances', () => {
    const controls = rule('.history-action,\n.history-chevron')
    expect(controls).toContain('width: 26px')
    expect(controls).toContain('border-radius: 7px')
    expect(css).toContain('transform: rotate(90deg)')
    expect(css).toContain('.execution-expand.open { transform: rotate(90deg); }')
  })

  it('turns the nested current-plan contract into a compact control strip', () => {
    const surface = rule('.history-current-plan .plan-control-surface')
    const primary = rule('.history-current-plan .plan-control-primary')
    expect(surface).toContain('box-shadow: none')
    expect(primary).toContain('min-height: 52px')
    expect(css).toContain('.history-current-plan .plan-control-copy .panel-kicker')
    expect(css).toContain('display: none')
  })
})
