import { describe, expect, it } from 'vitest'
import { css } from '../../cascade/styleRules'

describe('attention center CSS', () => {
  it('keeps the compact popover flat, readable and width-safe', () => {
    const attention = css.slice(css.lastIndexOf('/* Centro de Alertas'))

    expect(attention).toContain('.agent-attention-popover { width:min(420px,calc(100vw - 20px)); position:fixed; z-index:13020')
    expect(attention).toContain('.agent-attention-popover-metrics span { min-width:0; min-height:44px;')
    expect(attention).toContain('border:0; border-radius:0; background:transparent')
    expect(attention).toContain('.attention-list.compact .attention-card { position:relative; border:0;')
    expect(attention).toContain('box-shadow:none;')
    expect(attention).toContain('overflow-wrap:normal; word-break:normal; hyphens:none;')
    expect(attention).toContain('grid-template-columns:minmax(0,1fr) auto;')
    expect(css).toContain('.workspace-attention-button.has-alerts { border-color:color-mix(in srgb,var(--theme-accent) 26%,var(--theme-border))')
    expect(css).toContain('.workspace-attention-button.urgent .workspace-attention-count { background:var(--theme-danger,#b34f45); }')
    expect(css).toContain('.multi-project-actions .workspace-attention-count { top:4px; right:3px;')
  })
})
