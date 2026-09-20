import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/restart-confirmation.css'), 'utf8')

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
    expect(dialog).toContain('height: min(880px, calc(100vh - 32px))')
    expect(changes).toContain('min-height: 0')
    expect(changes).toContain('height: auto')
    expect(actions).toContain('grid-column: auto')
    expect(actions).toContain('justify-content: space-between')
  })

  it('keeps the file list and comparison pane as the flexible review surface', () => {
    expect(firstRule('.restart-confirmation-diff-layout')).toContain('grid-template-columns: minmax(215px, 27%) minmax(0, 1fr)')
    expect(firstRule('.change-diff-shell')).toContain('grid-template-rows: auto minmax(0, 1fr)')
    expect(css).toContain('.change-diff-legend .diff-before')
    expect(css).toContain('.change-diff-legend .diff-after')
  })
})
