import { tabBarSource, tabButtonSource } from '../../cascade/tabStyles'
import { describe, expect, it } from 'vitest'
import { css, lastRule, firstRule } from '../../cascade/styleRules'

describe('Docker services CSS regression', () => {
  it('keeps the pre-merge Docker workbench hierarchy instead of browser-default buttons', () => {
    const panel = lastRule('.docker-services-panel')
    const section = firstRule('.docker-section-heading')
    const composeToggle = lastRule('.docker-compose-toggle')
    const detailHeading = firstRule('.docker-container-heading')
    const detailTabs = tabBarSource
    const facts = firstRule('.docker-fact')

    expect(panel).toContain('--docker-font-scale:calc(var(--ui-font-scale) * var(--docker-user-scale, 1.15))')
    expect(section).toContain('display:grid')
    expect(section).toContain('grid-template-columns:10px 14px minmax(0,1fr) auto')
    expect(section).toContain('border:0')
    expect(section).toContain('background:transparent')
    expect(composeToggle).toContain('grid-template-columns:11px 8px minmax(0,1fr)')
    expect(composeToggle).toContain('border:0')
    expect(detailHeading).toContain('align-items:center')
    expect(detailTabs).toContain('group/tabs flex')
    expect(facts).toContain('grid-template-columns:minmax(74px,27%) minmax(0,1fr)')
    expect(tabButtonSource).toContain('aria-selected:after:bg-[var(--theme-tab-active)]')
    expect(css).not.toContain('.docker-detail-tabs button.active {')
  })
})
