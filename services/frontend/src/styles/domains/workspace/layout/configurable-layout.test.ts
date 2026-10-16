import statusBarSource from '../../../../components/workspace/shell/WorkbenchStatusBar.tsx?raw'
import settingsFrameSource from '../../../../components/project/settings/navigation/SettingsFrame.tsx?raw'
import { describe, expect, it } from 'vitest'
import { css, lastRule, firstRule } from '../../../cascade/styleRules'

describe('configurable workbench CSS', () => {
  it('keeps the central workspace elastic and exposes compact chrome tokens', () => {
    const compactRail = lastRule(":root[data-density='compact'] .workspace-main-row > .agent-activity-bar")
    expect(css).toContain('.workspace-center-column { flex: 1 1 0; min-width: 0;')
    expect(lastRule('.workspace-center-column')).toContain('min-width: 0')
    expect(css).not.toContain('max-width: 42vw')
    expect(css).toContain('.workspace-main-row { flex: 1; min-width: 0; min-height: 0; display: flex; overflow: hidden; }')
    expect(statusBarSource).toContain('min-h-7 shrink-0')
    expect(statusBarSource).toContain('text-whx-caption')
    expect(statusBarSource).toContain('<LayoutControls')
    expect(compactRail).toContain('width: 40px')
  })

  it('keeps tool drawers integrated while supporting bottom-corner tool rails', () => {
    const verticalRail = lastRule('.workspace-main-row > .workspace-side-rail')
    const bottomRail = lastRule(":root[data-tool-rail='bottom'] .workspace-main-row > .workspace-side-rail")
    expect(css).not.toContain("data-tool-window='floating'")
    expect(verticalRail).toContain('overflow:hidden')
    expect(verticalRail).not.toContain('overflow-y:auto')
    expect(verticalRail).toContain('scrollbar-width:none')
    expect(css).toContain('.workspace-main-row > .workspace-side-rail::-webkit-scrollbar { display:none; }')
    expect(bottomRail).toContain('position:absolute')
    expect(bottomRail).toContain('flex-direction:row')
    expect(bottomRail).toContain('width:max-content')
    expect(bottomRail).toContain('max-width:calc(100% - 12px)')
    expect(bottomRail).toContain('gap:5px')
    expect(bottomRail).toContain('overflow-x:hidden')
    expect(bottomRail).toContain('overflow-y:hidden')
    expect(lastRule('.workspace-side-rail button.active')).toContain('box-shadow:none')
    expect(settingsFrameSource).toContain("section === item.id ? '!bg-whx-hover !text-whx-text'")
    expect(settingsFrameSource).toContain('!border-0')
    expect(lastRule('.quick-switcher-segments button.active')).toContain('border-color: transparent')
    expect(lastRule('.accent-choice.active')).toContain('border-color:transparent')
  })

  it('uses a theme-aware scrollbar and keeps the terminal between vertical rails', () => {
    expect(lastRule('*::-webkit-scrollbar')).toContain('width: 6px')
    expect(lastRule('*::-webkit-scrollbar-thumb')).toContain('border-radius: 999px')
    expect(firstRule('.terminal-workspace')).toContain('width: auto')
    expect(firstRule('.workspace-center-column')).toContain('overflow: hidden')
    expect(lastRule('.workspace-center-column > .terminal-workspace')).toContain('width:100%')
    expect(lastRule('.workspace-center-column > .terminal-workspace')).toContain('min-width:0')
    expect(css).not.toContain('.workspace-body > .terminal-workspace { margin-left:44px; margin-right:44px; }')
    expect(lastRule('.terminal-resizer')).toContain('cursor: ns-resize')
  })

  it('keeps the editor single-pane and gives project files semantic glyph colors', () => {
    expect(lastRule('.editor-workspace')).toContain('grid-template-columns:minmax(0,1fr)')
    expect(lastRule('.file-glyph-env')).toContain('color:#c59b38')
    expect(lastRule('.file-glyph-typescript')).toContain('color:#4f9cf9')
  })
})
