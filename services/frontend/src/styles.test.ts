import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')

function lastRule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...css.matchAll(new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'gm'))]
  return matches.at(-1)?.[1] || ''
}

function firstRule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'))
  return match?.[1] || ''
}

describe('chat header CSS', () => {
  it('keeps the active chat header fixed while the transcript scrolls', () => {
    const header = firstRule('.chat-header')
    const stream = lastRule('.chat-stream')
    expect(header).toContain('position: sticky')
    expect(header).toContain('top: 0')
    expect(header).toContain('z-index: 12')
    expect(stream).toContain('overflow-x: hidden')
    expect(stream).toContain('overflow-y: auto')
  })

  it('keeps chat export as a compact square icon action', () => {
    const exportButton = firstRule('.chat-export-button')
    expect(exportButton).toContain('width: 32px')
    expect(exportButton).toContain('height: 32px')
    expect(exportButton).toContain('padding: 0')
    expect(exportButton).toContain('justify-content: center')
  })

  it('keeps the bundle strip dedicated to recent bundle cards', () => {
    const strip = lastRule('.bundle-exchange-bar')
    expect(strip).toContain('grid-template-columns:minmax(0, 1fr)')
    expect(css).not.toContain('.bundle-exchange-summary')
    expect(css).not.toContain('.bundle-quota-indicator')
  })
})


describe('execution queue CSS', () => {
  it('keeps the FIFO drawer compact and neutral instead of using accent-tinted cards', () => {
    const drawer = lastRule('.execution-queue-drawer')
    const metrics = lastRule('.execution-queue-metric')
    const concurrency = lastRule('.execution-queue-concurrency')
    const card = lastRule('.execution-queue-card')

    expect(drawer).toContain('background: var(--theme-bg)')
    expect(metrics).toContain('display: inline-flex')
    expect(metrics).not.toContain('box-shadow')
    expect(concurrency).toContain('border-top: 1px solid var(--theme-border-soft)')
    expect(card).toContain('background: var(--theme-surface)')
    expect(card).toContain('box-shadow: none')
  })
})

describe('archived chats drawer CSS', () => {
  it('keeps sparse chat cards compact and aligned to the top', () => {
    const list = lastRule('.agent-archive-list')
    const card = lastRule('.agent-archive-item')
    const empty = lastRule('.agent-archive-empty')

    expect(list).toContain('align-content: start')
    expect(list).toContain('grid-auto-rows: max-content')
    expect(card).toContain('border: 1px solid var(--theme-border-soft)')
    expect(card).toContain('background: var(--theme-surface)')
    expect(empty).toContain('border: 1px dashed var(--theme-border)')
  })
})

describe('agent runtime drawer CSS', () => {
  it('groups health, capacity and instance details into a calm card hierarchy', () => {
    const summary = lastRule('.agent-runtime-summary')
    const memorySummary = firstRule('.agent-runtime-memory-summary')
    const diagnostics = firstRule('.agent-runtime-diagnostics')
    const diagnosticRow = lastRule('.agent-runtime-diagnostic-row')
    const scale = firstRule('.agent-runtime-scale')
    const body = firstRule('.agent-runtime-body')
    const activeAgent = lastRule('.agent-runtime-list > button.active')
    const detail = lastRule('.agent-runtime-detail')

    // Four tiles since the shared pool gained cross-project occupancy: an
    // agent busy with another project has to be countable here, or the panel
    // reports no free Workers beside cards that all look idle.
    expect(summary).toContain('grid-template-columns:repeat(4,minmax(0,1fr))')
    expect(memorySummary).toContain('grid-template-columns:repeat(5,minmax(0,1fr))')
    expect(diagnostics).toContain('grid-template-columns:repeat(3,minmax(0,1fr))')
    expect(diagnosticRow).toContain('border-radius:10px')
    expect(scale).toContain('grid-template-columns:repeat(2,minmax(0,1fr))')
    expect(body).toContain('gap:9px')
    expect(activeAgent).toContain('box-shadow:inset 4px 0 0 var(--agent-state)')
    expect(lastRule('.agent-runtime-list > button.state-writing')).toContain('--agent-state:#9b6cff')
    expect(lastRule('.agent-runtime-list > button.state-listening')).toContain('--agent-state:#16a6c9')
    expect(lastRule('.agent-runtime-list > button.state-chat-empty')).toContain('--agent-state:#3f86d9')
    expect(detail).toContain('border-radius:10px')
  })
})

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

  it('anchors send to the far-right composer edge independently of toolbar intrinsic width', () => {
    const footer = lastRule('.composer-footer')
    const toolbar = lastRule('.composer-toolbar-row')
    const send = lastRule('.composer-toolbar-row .send-button')

    expect(footer).toContain('position: relative')
    expect(footer).toContain('width: 100%')
    expect(footer).toContain('padding: 6px 40px 9px 9px')
    expect(footer).toContain('display: grid')
    expect(footer).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(footer).toContain('justify-content: stretch')
    expect(footer).toContain('justify-items: stretch')
    expect(footer).toContain('border-radius: 0 0 14px 14px')
    expect(toolbar).toContain('width: 100%')
    expect(toolbar).toContain('min-width: 0')
    expect(toolbar).toContain('min-height: 31px')
    expect(toolbar).toContain('display: block')
    expect(send).toContain('position: absolute')
    expect(send).toContain('top: 6px')
    expect(send).toContain('right: 8px')
    expect(send).toContain('margin: 0')
    expect(lastRule('.composer-hint')).toContain('padding-right: 6px')
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

    expect(protectedMode).toContain('border-color: #7f9fbd')
    expect(protectedMode).toContain('background: #e2edf7')
    expect(protectedMode).toContain('color: #285676')
    expect(unprotectedMode).toContain('background: #f6e2de')
    expect(manualMode).toContain('border-color: #c3a36b')
    expect(manualMode).toContain('background: #f4ead7')
    expect(manualMode).toContain('color: #6b5126')
    expect(autoMode).toContain('background: #e4efe0')
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


  it('keeps application dialogs polished, modal and visually semantic', () => {
    const backdrop = firstRule('.app-dialog-backdrop')
    const card = firstRule('.app-dialog-card')
    const danger = lastRule('.app-dialog-button.primary.tone-danger')
    const warning = lastRule('.app-dialog-button.primary.tone-warning')

    expect(backdrop).toContain('position: fixed')
    expect(backdrop).toContain('backdrop-filter: blur(7px)')
    expect(card).toContain('border-radius: 22px')
    expect(card).toContain('box-shadow: 0 30px 95px')
    expect(danger).toContain('background: #8e4037')
    expect(warning).toContain('background: #755823')
  })

})


describe('multi-project shell CSS', () => {
  it('keeps the active project accent visible without a heavy glow', () => {
    const activeProject = lastRule('.project-quick-switch button.active')
    const activeUnderline = lastRule('.project-quick-switch button.active::after')
    const activeMark = lastRule('.project-quick-switch button.active .project-color-mark')

    expect(activeProject).toContain('box-shadow: 0 0 0 1px hsl(var(--project-hue) 76% 52% / .08), 0 2px 8px hsl(var(--project-hue) 70% 38% / .11)')
    expect(activeUnderline).toContain('box-shadow: 0 0 5px hsl(var(--project-hue) 84% 54% / .28)')
    expect(activeMark).toContain('box-shadow: 0 0 6px hsl(var(--project-hue) 72% 48% / .10)')
  })
})

describe('split Agent layout CSS', () => {
  it('uses a persistent resizable chat/inspector split with a shared chat strip', () => {
    const splitLayout = css.slice(css.lastIndexOf('/* v1.2.42'))
    // The chat keeps 60% of the usable width and the inspector 40%; the rail
    // and the side drawer are the shell's columns, not this grid's.
    expect(splitLayout).toContain('--agent-chat-width: calc((100% - 6px) * 0.6)')
    expect(splitLayout).toContain('grid-template-columns: minmax(320px, var(--agent-chat-width)) 6px minmax(320px, 1fr)')
    expect(splitLayout).toContain('grid-template-rows: 42px 42px minmax(0, 1fr)')
    expect(splitLayout).toContain('grid-template-columns: auto minmax(0, 1fr) auto auto')
    expect(splitLayout).toContain('.agent-direct-chatgpt-tab { grid-column: 1')
    expect(splitLayout).toContain('justify-self: start')
    expect(splitLayout).toContain('.agent-surface-tabs { grid-column: 4')
    expect(splitLayout).toContain('grid-template-columns: repeat(3, 42px)')
    expect(splitLayout).toContain('justify-self: end')
    expect(splitLayout).toContain('.agent-commandbar-center { position: absolute; inset: 0')
    expect(splitLayout).toContain('place-items: center')
    expect(splitLayout).toContain('pointer-events: none')
    expect(splitLayout).toContain('.agent-chat-switcher { grid-column: 1 / -1')
    expect(splitLayout).toContain('.agent-chat-stage { grid-column: 1; padding-left: 0')
    expect(splitLayout).toContain('.agent-inspector-stage { grid-column: 3')
    expect(splitLayout).toContain('.agent-splitter { grid-column: 2')
    expect(splitLayout).toContain('cursor: col-resize')
    expect(splitLayout).toContain('.agent-drawer { grid-column: 2; grid-row: 3; position: relative')
    expect(lastRule('.topbar-indicator')).toContain('width: 27px')
  })
})

describe('terminal and editor execution CSS', () => {
  it('keeps terminal tabs compact without exposing the horizontal scrollbar', () => {
    const tabs = lastRule('.terminal-tabs')
    const activeTab = lastRule('.terminal-tab-shell.active')
    expect(tabs).toContain('overflow-x: auto')
    expect(tabs).toContain('scrollbar-width: none')
    expect(css).toContain('.terminal-tabs::-webkit-scrollbar { display: none; }')
    expect(activeTab).toContain('box-shadow: inset 0 -2px #8db94b')
  })

  it('renders package script actions as a green play affordance in the Monaco gutter', () => {
    const glyph = lastRule('.editor-run-glyph::before')
    expect(glyph).toContain("content: '▶'")
    expect(glyph).toContain('color: #78b841')
  })
})
