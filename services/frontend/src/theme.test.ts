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

  it('keeps shared panel searches seamless in both themes', () => {
    expect(theme).toContain(":root[data-theme='light'] .panel-search-field input { border-color: transparent; background: transparent; color: var(--theme-text); }")
    expect(theme).toContain(":root[data-theme='dark'] .panel-search-field { border-color: #3b3b3b; background: #202020; color: #adadad; }")
    expect(theme).toContain(":root[data-theme='dark'] .panel-search-field input { border-color: transparent; background: transparent; color: #ececec; }")
  })

  it('keeps the effort selector integrated with the dark composer chrome', () => {
    expect(theme).toContain(":root[data-theme='dark'] .composer-effort-picker {")
    expect(theme).toContain(":root[data-theme='dark'] .composer-effort-picker select {")
    expect(theme).toContain("background: #292929; color: #e0e6dc;")
  })

  it('calibrates security and execution meanings independently in dark mode', () => {
    expect(theme).toContain("[data-theme='dark'] .composer-round-action.mode-protected.selected")
    expect(theme).toContain("[data-theme='dark'] .composer-round-action.mode-unprotected.selected")
    expect(theme).toContain("[data-theme='dark'] .composer-round-action.mode-manual.selected")
    expect(theme).toContain("[data-theme='dark'] .composer-round-action.mode-auto.selected")
  })

  it('keeps the dark palette neutral and overrides status notices with sufficient contrast', () => {
    expect(theme).toContain('--app-bg: #121212')
    expect(theme).toContain('--theme-surface: #1a1a1a')
    expect(theme).toContain('--theme-text: #edf1e9')
    expect(theme).toContain("[data-theme='dark'] .chat-notice.notice-status.notice-wharness:has(.message-iteration)")
    expect(theme).toContain('background: #292929;\n  color: #cecece;')
  })

  it('keeps chat message sender colors genuinely distinct in dark mode too', () => {
    expect(theme).toContain("[data-theme='dark'] .message-chatgpt .message-body { border-color: #3a5573; background: #1d2b3d; color: #bcd6f2; }")
    expect(theme).toContain("[data-theme='dark'] .message-wharness .message-body { border-color: #3d5a2e; background: #1e2b18; color: #b8dba0; }")
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

  it('themes the interrupted-execution recovery cards for dark mode instead of leaving them light-only', () => {
    expect(theme).toMatch(/\[data-theme='dark'\] \.execution-recovery-item \{[^}]*background: var\(--theme-muted\);/)
    expect(theme).toContain("[data-theme='dark'] .execution-recovery-item span")
  })

  it('keeps every dark settings control and active state monochrome', () => {
    expect(theme).toMatch(/\[data-theme='dark'\] \.context-settings-dialog \.primary-button \{[^}]*background: #ececec;/)
    expect(theme).toContain("[data-theme='dark'] .context-settings-dialog input[type='checkbox']")
    expect(theme).toContain('accent-color: #d0d0d0')
    expect(theme).toContain("[data-theme='dark'] .context-filter-switch button.active.included")
    expect(theme).toContain("[data-theme='dark'] .context-rule-state.enabled")
    expect(theme).toContain('background: #303030;\n  color: #cecece !important;')
  })
  it('keeps the active linked-project accent restrained in dark mode', () => {
    expect(theme).toContain('box-shadow: 0 0 0 1px hsl(var(--project-hue) 70% 58% / .08), 0 2px 8px hsl(var(--project-hue) 70% 48% / .14);')
    expect(theme).toContain('box-shadow: 0 0 0 2px hsl(var(--project-hue) 70% 56% / .10), 0 0 7px hsl(var(--project-hue) 76% 54% / .24);')
  })

  it('gives the integrated chat header and every bundle stage a distinct dark treatment', () => {
    expect(theme).toMatch(/:root\[data-theme='dark'\] \.chat-header \{[\s\S]*?background: linear-gradient/)
    expect(theme).toContain("[data-theme='dark'] .bundle-tone-request-main")
    expect(theme).toContain("[data-theme='dark'] .bundle-tone-request-repair")
    expect(theme).toContain("[data-theme='dark'] .bundle-tone-request-summary")
    expect(theme).toContain("[data-theme='dark'] .bundle-tone-response")
    expect(theme).toContain("[data-theme='dark'] .bundle-tone-final-summary")
  })

  it('keeps the self-evolution change summary readable in dark mode', () => {
    expect(theme).toMatch(/:root\[data-theme='dark'\] \.restart-confirmation-summary \{[^}]*background: linear-gradient\(135deg, #272c24 0%, #242424 100%\);/)
    expect(theme).toMatch(/:root\[data-theme='dark'\] \.restart-confirmation-summary p \{[^}]*color: #f1f4ee;/)
    expect(theme).toContain(":root[data-theme='dark'] .restart-confirmation-summary-label { color: #aebaa8; }")
  })

})
