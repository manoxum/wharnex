import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GitTabContent } from './GitTabContent'

describe('GitTabContent', () => {
  it('stretches the nested changes work area and keeps its own scroll bounded', () => {
    render(<GitTabContent label="Alterações" stretch><div>Subtabs</div></GitTabContent>)

    const panel = screen.getByRole('tabpanel', { name: 'Alterações' })
    expect(panel.className).toContain('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden')
    expect(panel.className).toContain('w-full px-0 py-2')
  })

  it('keeps ordinary Git tabs independently scrollable', () => {
    render(<GitTabContent label="Histórico" stretch={false}><div>Histórico</div></GitTabContent>)

    const panel = screen.getByRole('tabpanel', { name: 'Histórico' })
    expect(panel.className).toContain('grid min-h-0 min-w-0 flex-1 content-start overflow-y-auto')
    expect(panel.className).toContain('w-full px-0 py-2')
  })
})
