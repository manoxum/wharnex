import navigationSource from '../../../../components/workspace/shell/navigation/WorkspaceNavigation.tsx?raw'
import { describe, expect, it } from 'vitest'
import { css } from '../../../cascade/styleRules'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import settingsPageSource from '../../../../components/project/settings/presentation/SettingsPage.tsx?raw'

describe('quiet premium workbench design system', () => {
  it('defines one restrained geometry scale and removes card chrome from core IDE surfaces', () => {
    expect(css).toContain('--control-md: 32px')
    expect(css).toContain('--radius-control: 4px')
    expect(css).toContain('/* v1.2.49 — quiet premium workbench grammar.')
    expect(navigationSource).toContain('active !bg-whx-tool-selected !text-whx-text')
    expect(navigationSource).toContain('border-0 bg-whx-rail')
    expect(css).toContain('background: transparent')
    expect(css).toContain('.terminal-workspace:focus-within')
    expect(css).toContain('border-top-color: color-mix(in srgb, var(--theme-accent) 45%, var(--theme-border))')
    expect(settingsPageSource).toContain('border-t border-whx-border-soft pt-4')
    expect(css).toContain('.agent-runtime-list > button.active:not(:disabled)')
    expect(css).toContain('box-shadow: inset 2px 0 var(--agent-state)')
  })

  it('keeps scrollbars quiet and universal actions compact', () => {
    expect(css).toContain('.workspace-body *::-webkit-scrollbar { width: 4px; height: 4px; }')
    const editorTabs = readFileSync(resolve(process.cwd(), 'src/components/editor/canvas/EditorTabs.tsx'), 'utf8')
    expect(editorTabs).toContain('editor-surface-actions ml-auto flex h-full')
    expect(editorTabs).toContain('disabled:pointer-events-none disabled:opacity-35')
  })
})
