import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChatSurfaceTabs } from './ChatSurfaceTabs'
import { nextTabIndex } from './nextTabIndex'

describe('paired Chat tab exception', () => {
  it('renders only named icons, one selected Chat tab and a blue bottom border', () => {
    const html = renderToStaticMarkup(<ChatSurfaceTabs onNavigate={() => {}}/>)
    expect(html.match(/role="tab"/g)).toHaveLength(4)
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1)
    for (const label of ['Chat', 'Ficheiros', 'Plano', 'Execução']) expect(html).toContain(`aria-label="${label}"`)
    expect(html.match(/<svg/g)).toHaveLength(4)
    expect(html).not.toContain('<span')
    expect(html).toContain('after:bottom-0 after:h-0.5')
    expect(html).toContain('after:bg-[var(--theme-tab-active)]')
  })
  it('wraps enabled surface navigation and honors Home/End', () => {
    expect(nextTabIndex('ArrowRight', 3, 4)).toBe(0)
    expect(nextTabIndex('ArrowLeft', 0, 4)).toBe(3)
    expect(nextTabIndex('Home', 2, 4)).toBe(0)
    expect(nextTabIndex('End', 0, 4)).toBe(3)
    expect(nextTabIndex('Escape', 0, 4)).toBeUndefined()
  })
})
