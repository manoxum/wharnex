import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const theme = readFileSync(resolve(process.cwd(), 'src/theme.css'), 'utf8')

describe('complete colour themes', () => {
  it('defines explicit palettes and component coverage for both modes', () => {
    expect(theme).toContain(":root[data-theme='light']")
    expect(theme).toContain(":root[data-theme='dark']")

    for (const surface of [
      '.bootstrap-shell', '.workspace-topbar', '.agent-workspace', '.chat-panel',
      '.composer', '.inspector-panel', '.editor-workspace', '.file-explorer',
      '.ide-terminal', '.context-settings-dialog', '.app-dialog-card',
    ]) expect(theme).toContain(surface)
  })

  it('calibrates security and execution meanings independently in dark mode', () => {
    expect(theme).toContain("[data-theme='dark'] .composer-round-action.mode-protected.selected")
    expect(theme).toContain("[data-theme='dark'] .composer-round-action.mode-unprotected.selected")
    expect(theme).toContain("[data-theme='dark'] .composer-round-action.mode-manual.selected")
    expect(theme).toContain("[data-theme='dark'] .composer-round-action.mode-auto.selected")
  })

  it('keeps the dark palette neutral and overrides status notices with sufficient contrast', () => {
    expect(theme).toContain('--app-bg: #111410')
    expect(theme).toContain('--theme-surface: #191d18')
    expect(theme).toContain('--theme-text: #edf1e9')
    expect(theme).toContain("[data-theme='dark'] .chat-notice.notice-status.notice-wharness:has(.message-iteration)")
    expect(theme).toContain('background: #292929;\n  color: #cecece;')
  })

  it('does not tint large active or verification surfaces green', () => {
    expect(theme).toMatch(/\[data-theme='dark'\] \.composer\.comment-mode \{[^}]*background: #171717;/)
    expect(theme).toContain("[data-theme='dark'] .operation.verification")
    expect(theme).toMatch(/\[data-theme='dark'\] \.operation\.verification,[\s\S]*?background: #252525;/)
    expect(theme).toMatch(/\[data-theme='dark'\] \.desktop-chatgpt-notice \{[^}]*background: #252525;/)
  })

  it('keeps the full settings experience light when the light theme is active', () => {
    expect(theme).toMatch(/\[data-theme='light'\] \.settings-navigation \{[^}]*background: #eef1ea;/)
    expect(theme).toMatch(/\[data-theme='light'\] \.settings-content,[\s\S]*?\.remote-storage-settings \{[^}]*background: #f7f8f4;/)
    expect(theme).toMatch(/\[data-theme='light'\] \.remote-instance-card \{[^}]*background: #f8f9f5;/)
    expect(theme).toMatch(/\[data-theme='light'\] \.provider-connection-panel \{[^}]*background: #f2f4ee;/)
    expect(theme).toMatch(/\[data-theme='light'\] \.remote-storage-actions \{[^}]*background: rgba\(247,248,244,.96\);/)
    expect(theme).toMatch(/\[data-theme='light'\] \.remote-instance-grid input,[\s\S]*?background: #fff;/)
  })

  it('keeps every dark settings control and active state monochrome', () => {
    expect(theme).toMatch(/\[data-theme='dark'\] \.context-settings-dialog \.primary-button \{[^}]*background: #ececec;/)
    expect(theme).toContain("[data-theme='dark'] .context-settings-dialog input[type='checkbox']")
    expect(theme).toContain('accent-color: #d0d0d0')
    expect(theme).toContain("[data-theme='dark'] .context-filter-switch button.active.included")
    expect(theme).toContain("[data-theme='dark'] .context-rule-state.enabled")
    expect(theme).toContain('background: #303030;\n  color: #cecece !important;')
  })
})
