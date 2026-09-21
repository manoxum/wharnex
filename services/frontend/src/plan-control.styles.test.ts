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

  it('keeps the extracted control styling out of the legacy stylesheet', () => {
    expect(legacy).not.toContain('.plan-control-surface {')
    expect(legacy).not.toContain('.plan-control-primary {')
    expect(legacy).not.toContain('.plan-manual-tools {')
  })
})
