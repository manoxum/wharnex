import composerToolbarSource from '../../../components/chat/composer/toolbar/ComposerToolbar.tsx?raw'
import { describe, expect, it } from 'vitest'
import { css, lastRule, firstRule } from '../../cascade/styleRules'

describe('composer layout CSS', () => {
  it('keeps rich directive chips as one compact horizontal token', () => {
    const chip = lastRule('.composer-rich-editor .ql-editor .composer-directive-chip')
    const label = lastRule('.composer-directive-chip-label')
    const configure = lastRule('.composer-directive-chip-configure')

    expect(chip).toContain('display: inline-flex !important')
    expect(chip).toContain('flex-flow: row nowrap !important')
    expect(chip).toContain('white-space: nowrap !important')
    expect(chip).toContain('height: 30px')
    expect(chip).toContain('gap: 8px')
    expect(chip).toContain('padding: 5px 5px 5px 6px')
    expect(label).toContain('max-width: 28ch')
    expect(label).toContain('align-items: center')
    expect(label).toContain('margin-inline-start: 2px')
    expect(label).toContain('text-overflow: ellipsis')
    expect(configure).toContain('width: 19px !important')
  })

  it('keeps a readable composer floor and makes the remaining editor surface focusable', () => {
    const editorShell = lastRule('.composer-editor-shell')
    const richEditor = lastRule('.composer-rich-editor')
    const quill = lastRule('.composer-rich-editor > .quill')
    const quillContainer = lastRule('.composer-rich-editor .ql-container.ql-bubble')
    const quillEditor = lastRule('.composer-rich-editor .ql-editor')

    expect(css).toContain('.composer { min-height: 180px; max-height: min(420px, 54vh); height: 180px;')
    expect(editorShell).toContain('flex: 1 1 auto')
    expect(editorShell).toContain('min-height: 92px')
    expect(editorShell).toContain('cursor: text')
    expect(richEditor).toContain('min-height: 100%')
    expect(quill).toContain('display: flex')
    expect(quillContainer).toContain('min-height: 100%')
    expect(quillEditor).toContain('min-height: 100%')
  })

  it('uses the whole top composer edge as the vertical resize handle', () => {
    const composer = lastRule('.composer')
    const handle = lastRule('.composer-resize-handle')

    expect(composer).toContain('position: relative')
    expect(composer).toContain('resize: none')
    expect(composer).toContain('border-bottom-color: color-mix')
    expect(composer).toContain('box-shadow: 0 10px 28px var(--theme-shadow)')
    expect(handle).toContain('top: -6px')
    expect(handle).toContain('left: 0')
    expect(handle).toContain('right: 0')
    expect(handle).toContain('height: 12px')
    expect(handle).toContain('cursor: ns-resize')
    expect(handle).toContain('touch-action: none')
  })

  it('pulses the composer border and keeps the larger warm project cue while typing', () => {
    const typingAttention = firstRule('.composer.composer-typing-attention')
    const darkTypingAttention = lastRule(":root[data-theme='dark'] .composer.composer-typing-attention")
    const projectBadge = lastRule('.composer-project-attention')
    const projectName = firstRule('.composer-project-attention > strong')
    const projectIcon = lastRule('.composer-project-attention svg')

    expect(typingAttention).toContain('--composer-project-name-warm: #c56a16')
    expect(typingAttention).toContain('animation: current-composer-project-pulse .9s ease-in-out infinite')
    expect(typingAttention).toContain('border-color: color-mix(in srgb, var(--theme-accent) 58%, var(--theme-border))')
    expect(darkTypingAttention).toContain('--composer-project-name-warm: #ffd166')
    expect(projectBadge).toContain('var(--theme-accent) 42%')
    expect(projectBadge).toContain('var(--theme-elevated) 90%')
    expect(projectBadge).toContain('font-size: calc(9.2px * var(--ui-font-scale))')
    expect(projectName).toContain('font-weight: 800')
    expect(projectName).toContain('linear-gradient(90deg')
    expect(projectName).toContain('animation: composer-project-name-sweep 1.25s ease-in-out infinite alternate')
    expect(projectIcon).toContain('color: var(--theme-accent)')
    expect(css).toContain('@keyframes current-composer-project-pulse')
    expect(css).toContain('@keyframes composer-project-name-sweep')
    expect(css).toContain('outline-offset: 2px')
  })

  it('anchors send to the far-right composer edge independently of toolbar intrinsic width', () => {
    expect(composerToolbarSource).toContain('composer-footer grid min-w-0 shrink-0')
    expect(composerToolbarSource).toContain('flex min-w-0 items-end gap-3')
    expect(composerToolbarSource).toContain('composer-action-row flex min-w-0 flex-1 flex-wrap')
    expect(composerToolbarSource).toContain('className="shrink-0 [&>button]:!static')
    expect(composerToolbarSource).toContain('[&>button]:!size-9')
    expect(composerToolbarSource).toContain('[&>button]:!min-w-9')
    expect(composerToolbarSource).toContain('[&>button]:!m-0')
    expect(composerToolbarSource).toContain('[&>button]:focus-visible:!outline-whx-accent')
    expect(composerToolbarSource).toContain('text-whx-caption leading-relaxed')

  })


  it('renders effort as a compact two-stage capsule instead of a native select pill', () => {
    const effort = lastRule('.composer-effort-picker')
    const select = lastRule('.composer-effort-picker select')
    const arrow = lastRule('.composer-effort-picker::after')

    expect(effort).toContain('position: relative')
    expect(effort).toContain('border-radius: 999px')
    expect(effort).toContain('gap: 6px')
    expect(select).toContain('appearance: none')
    expect(select).toContain('border-radius: 999px')
    expect(select).toContain('font-variant-numeric: tabular-nums')
    expect(arrow).toContain('transform: rotate(45deg)')
  })

  it('uses calm semantic palettes for selected execution and automation icons', () => {
    const protectedMode = lastRule('.composer-round-action.mode-protected.selected')
    const unprotectedMode = lastRule('.composer-round-action.mode-unprotected.selected')
    const manualMode = lastRule('.composer-round-action.mode-manual.selected')
    const autoMode = lastRule('.composer-round-action.mode-auto.selected')
    const autoApproveMode = lastRule('.composer-round-action.mode-auto-approve.selected')

    expect(protectedMode).toContain('border-color: #7f9fbd')
    expect(protectedMode).toContain('background: #e2edf7')
    expect(protectedMode).toContain('color: #285676')
    expect(unprotectedMode).toContain('background: #f6e2de')
    expect(manualMode).toContain('border-color: #c3a36b')
    expect(manualMode).toContain('background: #f4ead7')
    expect(manualMode).toContain('color: #6b5126')
    expect(autoMode).toContain('background: #e4efe0')
    expect(autoApproveMode).toContain('border-color: #7e86b8')
    expect(autoApproveMode).toContain('background: #e8e8f6')
  })

  it('gives the chat transport mode icons their own distinct palette from execution/automation', () => {
    const scraperMode = lastRule('.composer-round-action.mode-scraper.selected')
    const manualTransportMode = lastRule('.composer-round-action.mode-manual-transport.selected')

    expect(scraperMode).toContain('border-color: #8b7fc9')
    expect(scraperMode).toContain('background: #e7e3f7')
    expect(manualTransportMode).toContain('border-color: #6ba3a3')
    expect(manualTransportMode).toContain('background: #dcf0ef')
  })

  it('gives each chat message sender a genuinely distinct color instead of near-identical shades of grey', () => {
    const chatgpt = lastRule('.message-chatgpt .message-body')
    const wharness = lastRule('.message-wharness .message-body')
    expect(chatgpt).toContain('background: #eaf1fb')
    expect(chatgpt).toContain('border-color: #b9cfe8')
    expect(wharness).toContain('background: #edf5e7')
    expect(wharness).toContain('border-color: #b9d2a2')
    // The two must not resolve to the same color.
    expect(chatgpt).not.toEqual(wharness)
  })


  it('keeps application dialogs polished inside the non-blocking window system', () => {
    const windowLayer = firstRule('.internal-window-layer')
    const controls = firstRule('.internal-window-controls')
    const dragHandle = firstRule(".internal-window-shell [data-internal-window-drag-handle='true']")
    const resizeGrip = firstRule('.internal-window-resize-grip')
    const maximized = firstRule(".internal-window-shell[data-internal-window-maximized='true']")
    const dock = firstRule('.internal-window-dock')
    const card = firstRule('.app-dialog-card')
    const danger = lastRule('.app-dialog-button.primary.tone-danger')
    const warning = lastRule('.app-dialog-button.primary.tone-warning')

    expect(windowLayer).toContain('pointer-events: none')
    expect(windowLayer).toContain('background: transparent')
    expect(controls).toContain('top: 8px')
    expect(controls).toContain('right: 8px')
    expect(dragHandle).toContain('cursor: grab')
    expect(dragHandle).toContain('touch-action: none')
    expect(resizeGrip).toContain('cursor: nwse-resize')
    expect(maximized).toContain('width: calc(100vw - 16px)')
    expect(maximized).toContain('height: calc(100dvh - 16px)')
    expect(dock).toContain('right: 12px')
    expect(dock).toContain('bottom: 12px')
    expect(card).toContain('border-radius: 22px')
    expect(card).toContain('box-shadow: 0 30px 95px')
    expect(danger).toContain('background: #8e4037')
    expect(warning).toContain('background: #755823')
  })

})
