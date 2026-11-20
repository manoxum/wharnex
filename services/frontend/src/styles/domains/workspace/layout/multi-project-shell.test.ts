import { describe, expect, it } from 'vitest'
import { firstRule } from '../../../cascade/styleRules'
import { projectTabsSource, tabButtonSource, projectChromeSource } from '../../../cascade/tabStyles'

describe('multi-project shell chrome', () => {
  it('uses the shell header as draggable title-bar chrome without swallowing controls', () => {
    const bar = firstRule('.multi-project-bar')
    const controls = firstRule(".multi-project-bar button, .multi-project-bar input, .multi-project-bar select, .multi-project-bar textarea, .multi-project-bar label, .multi-project-bar [role='menu'], .multi-project-bar [role='dialog']")
    expect(bar).toContain('-webkit-app-region: drag')
    expect(bar).not.toContain('titlebar-area-width')
    expect(bar).toContain('height: 48px')
    expect(controls).toContain('-webkit-app-region: no-drag')
    expect(projectTabsSource).toContain('[-webkit-app-region:no-drag]')
  })
  it('restores the restrained original project hue, rounded button and active selection', () => {
    expect(projectTabsSource).toContain('style={accentStyle(path)}')
    expect(projectChromeSource).toContain('hsl(var(--project-hue)_68%_72%)')
    expect(tabButtonSource).toContain('shadow-none')
    expect(tabButtonSource).toContain('aria-selected:after:bg-[hsl(var(--project-hue)_78%_50%)]')
    expect(projectTabsSource).toContain('appearance="project"')
  })
  it('keeps unlink affordance embedded as a separate explicit project action', () => {
    expect(projectTabsSource).toContain('absolute right-1 top-1/2')
    expect(projectTabsSource).toContain('onClick={() => onUnbind(path)}')
    expect(projectTabsSource).toContain('aria-label={`Desvincular ${projectName(path)} desta janela`}')
  })
  it('emphasizes only the active project on composer input and respects reduced motion', () => {
    expect(projectTabsSource).toContain('active && composerTypingProject === path')
    expect(projectTabsSource).toContain("typing ? projectTypingChrome : ''")
    expect(projectChromeSource).toContain('motion-reduce:animate-none')
    expect(projectChromeSource).toContain('wharnex-project-composer-pulse')
  })
})
