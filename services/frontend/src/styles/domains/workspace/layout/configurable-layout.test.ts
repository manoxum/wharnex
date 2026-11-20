import navigationSource from '../../../../components/workspace/shell/navigation/WorkspaceNavigation.tsx?raw'
import appearanceSource from '../../../../components/workspace/shell/appearance/AppearanceChoices.tsx?raw'
import rightRailSource from '../../../../components/workspace/shell/WorkspaceRightRail.tsx?raw'
import statusBarSource from '../../../../components/workspace/shell/WorkbenchStatusBar.tsx?raw'
import settingsFrameSource from '../../../../components/project/settings/navigation/SettingsFrame.tsx?raw'
import { describe, expect, it } from 'vitest'
import { css, lastRule, firstRule } from '../../../cascade/styleRules'

describe('configurable workbench CSS', () => {
  it('keeps the central workspace elastic and exposes compact chrome tokens', () => {
    const compactRail = navigationSource
    expect(css).toContain('.workspace-center-column { flex: 1 1 0; min-width: 0;')
    expect(lastRule('.workspace-center-column')).toContain('min-width: 0')
    expect(css).not.toContain('max-width: 42vw')
    expect(css).toContain('.workspace-main-row { flex: 1; min-width: 0; min-height: 0; display: flex; overflow: hidden; }')
    expect(statusBarSource).toContain('min-h-7 shrink-0')
    expect(statusBarSource).toContain('text-whx-caption')
    expect(statusBarSource).toContain('<LayoutControls')
    expect(compactRail).toContain('w-12 basis-12')
    expect(compactRail).toContain('[[data-density=compact]_&]:!size-8')
  })

  it('keeps tool drawers integrated while supporting bottom-corner tool rails', () => {
    const verticalRail = navigationSource
    const bottomRail = navigationSource
    expect(css).not.toContain("data-tool-window='floating'")
    expect(verticalRail).toContain('!overflow-x-hidden')
    expect(verticalRail).toContain('!overflow-y-auto')
    expect(verticalRail).toContain('[scrollbar-width:thin]')
    expect(rightRailSource).toContain('bg-whx-rail')
    expect(css).not.toContain('.workspace-right-rail {')
    expect(navigationSource).toContain('[[data-tool-rail=bottom]_&]:!overflow-x-auto')
    expect(bottomRail).toContain('[[data-tool-rail=bottom]_&]:absolute')
    expect(bottomRail).toContain('[[data-tool-rail=bottom]_&]:flex-row')
    expect(bottomRail).toContain('[[data-tool-rail=bottom]_&]:w-auto')
    expect(bottomRail).toContain('[[data-tool-rail=bottom]_&]:max-w-[calc(100%-16px)]')
    expect(bottomRail).toContain('gap-1.5')
    expect(bottomRail).toContain('!overflow-x-hidden')
    expect(bottomRail).toContain('!overflow-y-auto')
    expect(navigationSource).toContain('!shadow-none')
    expect(settingsFrameSource).toContain("section === item.id ? '!bg-whx-hover !text-whx-text'")
    expect(settingsFrameSource).toContain('!border-0')
    expect(appearanceSource).toContain('border-whx-accent bg-whx-accent-soft text-whx-text')
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
    expect(css).not.toContain('.terminal-resizer:hover, body.terminal-resizing .terminal-resizer')
  })

  it('keeps the editor single-pane and gives project files semantic glyph colors', () => {
    expect(lastRule('.editor-workspace')).toContain('grid-template-columns:minmax(0,1fr)')
    expect(lastRule('.file-glyph-env')).toContain('color:#c59b38')
    expect(lastRule('.file-glyph-typescript')).toContain('color:#4f9cf9')
  })
})
