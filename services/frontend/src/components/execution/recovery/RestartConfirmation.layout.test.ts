import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readStyleSource } from '../../../styles/cascade/readStyleSource'

const css = readStyleSource('styles/domains/evolution/restart-confirmation.css')
const reportCss = readFileSync(resolve(process.cwd(), 'src/styles/domains/evolution/restart-confirmation-reports.css'), 'utf8')

function firstRule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'))
  return match?.[1] || ''
}

describe('restart confirmation layout CSS', () => {
  it('reserves a dedicated footer row so activation actions cannot be clipped', () => {
    const dialog = firstRule('.restart-confirmation-dialog')
    const changes = firstRule('.restart-confirmation-changes')
    const actions = firstRule('.restart-confirmation-actions')

    expect(dialog).toContain('grid-template-rows: auto auto minmax(0, 1fr) auto')
    expect(dialog).toContain('height: min(820px, calc(100dvh - 56px))')
    expect(changes).toContain('grid-template-rows: auto minmax(0, 1fr)')
    expect(reportCss).toContain('grid-template-rows: auto auto minmax(0, 1fr)')
    expect(readFileSync(resolve(process.cwd(), 'src/components/execution/recovery/RestartConfirmation.tsx'), 'utf8')).toContain('<WorkbenchTabs label="Relatórios acumulados"')
    expect(changes).toContain('min-height: 0')
    expect(changes).toContain('height: auto')
    expect(actions).toContain('grid-column: auto')
    expect(actions).toContain('justify-content: space-between')
  })

  it('reuses the Git diff review hierarchy for the activation comparison', () => {
    const review = firstRule('.restart-confirmation-changes > .git-diff-review')
    const activeFile = firstRule('.restart-confirmation-changes .git-diff-review-files button.active')

    expect(review).toContain('grid-template-columns: minmax(230px, 27%) minmax(0, 1fr)')
    expect(review).toContain('border-radius: 0')
    expect(activeFile).toContain('box-shadow: inset 2px 0 0 var(--theme-accent)')
    expect(firstRule('.change-diff-shell')).toContain('grid-template-rows: auto minmax(0, 1fr)')
    expect(css).toContain('.change-diff-legend .diff-before')
    expect(css).toContain('.change-diff-legend .diff-after')
  })
})
