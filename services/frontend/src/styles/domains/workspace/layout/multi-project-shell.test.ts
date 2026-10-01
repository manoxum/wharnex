import { describe, expect, it } from 'vitest'
import { css, lastRule, firstRule } from '../../../cascade/styleRules'

describe('multi-project shell CSS', () => {
  it('uses the shell header as draggable title-bar chrome without swallowing controls', () => {
    const bar = firstRule('.multi-project-bar')
    const controls = firstRule(".multi-project-bar button, .multi-project-bar input, .multi-project-bar select, .multi-project-bar textarea, .multi-project-bar label, .multi-project-bar [role='menu'], .multi-project-bar [role='dialog'], .multi-project-bar .project-window-popover")
    expect(bar).toContain('-webkit-app-region: drag')
    expect(bar).not.toContain('titlebar-area-width')
    expect(bar).toContain('height: 48px')
    expect(controls).toContain('-webkit-app-region: no-drag')
  })

  it('keeps the active project accent visible without a heavy glow', () => {
    const activeProject = lastRule('.project-quick-switch button.active')
    const activeUnderline = lastRule('.project-quick-switch button.active::after')
    const activeMark = lastRule('.project-quick-switch button.active .project-color-mark')

    expect(activeProject).toContain('box-shadow: 0 1px 3px color-mix(in srgb, var(--theme-shadow) 32%, transparent)')
    expect(activeUnderline).not.toContain('box-shadow')
    expect(activeMark).toContain('box-shadow: none')
  })

  it('keeps unlink affordance embedded in project tabs', () => {
    expect(lastRule('.project-tab-shell')).toContain('position: relative')
    expect(lastRule('.project-quick-switch .project-tab-shell > .project-tab-main')).toContain('padding-right: 30px')
    expect(lastRule('.project-tab-unbind')).toContain('position: absolute !important')
    expect(css).toContain('.project-tab-shell:hover .project-tab-unbind, .project-tab-shell.active .project-tab-unbind, .project-tab-unbind:focus-visible { opacity: 1; }')
  })

  it('pulses the active project while a composer is being edited', () => {
    const typingProject = firstRule('.project-quick-switch button.active.composer-typing-attention')
    expect(typingProject).toContain('animation: current-project-composer-pulse .9s ease-in-out infinite')
    expect(css).toContain('@keyframes current-project-composer-pulse')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('.project-quick-switch button.active.composer-typing-attention { animation: none;')
    expect(css).toContain('outline: 2px solid hsl(var(--project-hue) 78% 52% / .58)')
  })
})
