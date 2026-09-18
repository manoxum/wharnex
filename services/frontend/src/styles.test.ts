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

  it('keeps context identity, state and export in one compact header cluster', () => {
    const context = firstRule('.chat-header-context')
    const actions = firstRule('.chat-header-context-actions')
    const iconActions = firstRule('.chat-header-context-copy-button, .chat-header-context .chat-export-button')
    expect(context).toContain('max-width: min(300px, 42vw)')
    expect(context).toContain('display: flex')
    expect(actions).toContain('margin-left: auto')
    expect(iconActions).toContain('width: 28px')
    expect(iconActions).toContain('height: 28px')
    expect(css).not.toContain('.chat-header-context-copy {')
    expect(css).not.toContain('.chat-header-context small {')
  })

  it('keeps the bundle strip dedicated to recent bundle cards', () => {
    const strip = lastRule('.bundle-exchange-bar')
    expect(strip).toContain('grid-template-columns:minmax(0, 1fr)')
    expect(css).not.toContain('.bundle-exchange-summary')
    expect(css).not.toContain('.bundle-quota-indicator')
  })
})

describe('applied change summary CSS', () => {
  it('renders the total deletion count with the same red tone as file deletions', () => {
    const totalDeletions = lastRule('.change-summary-card > header > code i')
    expect(totalDeletions).toContain('color: #a05249')
    expect(totalDeletions).toContain('font-style: normal')
  })
})

describe('execution output CSS', () => {
  it('uses stream-aware rows and a distinct stderr background without visible prefixes', () => {
    const segment = lastRule('.execution-output-segment')
    const stderr = lastRule('.execution-output-segment.stderr')

    expect(segment).toContain('white-space: pre-wrap')
    expect(segment).toContain('background: transparent')
    expect(stderr).toContain('background: rgba(184,110,102,.16)')
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

describe('panel search controls CSS', () => {
  it('shares one polished search treatment across compact drawers and utility panels', () => {
    const field = lastRule('.panel-search-field')
    const focused = lastRule('.panel-search-field:focus-within')
    const input = lastRule('.panel-search-field input')
    const archiveCount = lastRule('.agent-archive-filter-count')
    const artifactControls = lastRule('.artifact-explorer-toolbar > select, .artifact-explorer-toolbar > button, .artifact-explorer-filters select, .artifact-explorer-filters input')

    expect(field).toContain('height: 38px')
    expect(field).toContain('border-radius: 10px')
    expect(field).toContain('background: color-mix')
    expect(focused).toContain('box-shadow: 0 0 0 2px')
    expect(input).toContain('background: transparent')
    expect(input).toContain('var(--ui-font-family)')
    expect(archiveCount).toContain('border-radius: 999px')
    expect(artifactControls).toContain('height: 38px')
    expect(artifactControls).toContain('border-radius: 10px')
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
  it('uses the shell header as draggable title-bar chrome without swallowing controls', () => {
    const bar = firstRule('.multi-project-bar')
    const controls = firstRule(".multi-project-bar button, .multi-project-bar input, .multi-project-bar select, .multi-project-bar textarea, .multi-project-bar label, .multi-project-bar [role='menu'], .multi-project-bar [role='dialog'], .multi-project-bar [data-chatgpt-overlay-blocker='true']")
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
})

describe('split Agent layout CSS', () => {
  it('keeps the resizable split while moving Agent shortcuts into a dedicated right rail', () => {
    const splitLayout = css.slice(css.lastIndexOf('/* v1.2.47'))
    expect(splitLayout).toContain('--agent-tools-width: 42px')
    expect(splitLayout).toContain('--agent-chat-width: calc((100% - 48px) * 0.6)')
    expect(splitLayout).toContain('grid-template-columns: minmax(320px, var(--agent-chat-width)) 6px minmax(320px, 1fr) var(--agent-tools-width)')
    expect(splitLayout).toContain('grid-template-rows: 42px minmax(0, 1fr)')
    expect(splitLayout).toContain('.agent-commandbar {')
    expect(splitLayout).toContain('grid-column: 4')
    expect(splitLayout).toContain('grid-row: 1 / 3')
    expect(splitLayout).toContain('flex-direction: column')
    expect(splitLayout).toContain('.agent-chat-switcher { grid-column: 1 / 4; grid-row: 1; }')
    expect(splitLayout).toContain('.agent-chat-stage { grid-column: 1; grid-row: 2; }')
    expect(splitLayout).toContain('.agent-inspector-stage { grid-column: 3; grid-row: 2; }')
    expect(splitLayout).toContain('.agent-splitter { grid-column: 2; grid-row: 2; }')
    expect(splitLayout).toContain('.agent-commandbar .agent-attention-popover { right: calc(100% + 8px); top: 0; }')
    expect(splitLayout).toContain('grid-template-rows: repeat(4, 42px)')
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
    expect(activeTab).toContain('box-shadow: inset 0 -2px var(--theme-accent)')
  })

  it('renders package script actions as a green play affordance in the Monaco gutter', () => {
    const glyph = lastRule('.editor-run-glyph::before')
    expect(glyph).toContain("content: '▶'")
    expect(glyph).toContain('color: #78b841')
  })
})


describe('configurable workbench CSS', () => {
  it('keeps the central workspace dominant and exposes compact chrome tokens', () => {
    const compactRail = lastRule(":root[data-density='compact'] .workspace-main-row > .agent-activity-bar")
    expect(css).toContain('.workspace-mode-stack { flex: 1 1 760px; min-width: 560px;')
    expect(css).toContain('.workspace-main-row { flex: 1; min-width: 0; min-height: 0; display: flex; overflow: hidden; }')
    expect(css).toContain('.workbench-status-bar { height: 24px; flex: 0 0 24px;')
    expect(compactRail).toContain('width: 40px')
  })

  it('keeps tool drawers integrated while supporting bottom-corner tool rails', () => {
    const bottomRail = lastRule(":root[data-tool-rail='bottom'] .workspace-main-row > .workspace-side-rail")
    expect(css).not.toContain("data-tool-window='floating'")
    expect(bottomRail).toContain('position:absolute')
    expect(bottomRail).toContain('flex-direction:row')
    expect(bottomRail).toContain('overflow-x:auto')
  })

  it('uses a theme-aware scrollbar and keeps the terminal between vertical rails', () => {
    expect(lastRule('*::-webkit-scrollbar')).toContain('width: 10px')
    expect(lastRule('*::-webkit-scrollbar-thumb')).toContain('border-radius: 999px')
    expect(firstRule('.terminal-workspace')).toContain('width: auto')
    expect(css).toContain('.workspace-body > .terminal-workspace { margin-left:44px; margin-right:44px; }')
    expect(css).toContain(":root[data-tool-rail='bottom'] .workspace-body > .terminal-workspace { margin-left:0; margin-right:0; }")
    expect(lastRule('.terminal-resizer')).toContain('cursor: ns-resize')
  })

  it('keeps the editor single-pane and gives project files semantic glyph colors', () => {
    expect(lastRule('.editor-workspace')).toContain('grid-template-columns:minmax(0,1fr)')
    expect(lastRule('.file-glyph-env')).toContain('color:#c59b38')
    expect(lastRule('.file-glyph-typescript')).toContain('color:#4f9cf9')
  })
})

describe('Git workbench CSS', () => {
  it('uses project theme tokens instead of the old green-tinted dark island', () => {
    const drawer = lastRule('.git-drawer')
    const section = lastRule('.git-section')
    const tabs = lastRule('.git-tabs')

    expect(drawer).toContain('background: var(--theme-bg)')
    expect(drawer).toContain('color: var(--theme-text)')
    expect(section).toContain('background: var(--theme-surface)')
    expect(section).toContain('border: 1px solid var(--theme-border-soft)')
    expect(tabs).toContain('background: var(--theme-surface)')
    expect(tabs).not.toContain('#1b1e19')
    expect(section).not.toContain('#1a1d18')
  })

  it('keeps Git tabs fully visible and increases the working-copy reading density', () => {
    const tabs = lastRule('.git-tabs')
    const changeTabs = lastRule('.git-changes-tabs')
    const pendingCommit = lastRule('.git-unpushed-list li')
    expect(tabs).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))')
    expect(tabs).toContain('overflow: visible')
    expect(changeTabs).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(changeTabs).toContain('overflow: visible')
    expect(pendingCommit).toContain('min-height: 52px')
    expect(lastRule('.agent-tree-row')).toContain('height: 30px')
  })

  it('gives Git mutations a modal processing surface with visible progress', () => {
    const backdrop = firstRule('.git-operation-backdrop')
    const modal = firstRule('.git-operation-modal')
    const progress = firstRule('.git-operation-progress')

    expect(backdrop).toContain('position: absolute')
    expect(backdrop).toContain('backdrop-filter: blur(5px)')
    expect(lastRule('.project-git-operation-layer')).toContain('position: fixed')
    expect(lastRule('.project-git-operation-layer')).toContain('inset: 0')
    expect(modal).toContain('grid-template-columns: 42px minmax(0,1fr)')
    expect(progress).toContain('height: 4px')
    expect(css).toContain('@keyframes git-operation-progress')
  })

  it('keeps history rows graph-first and compact', () => {
    const row = lastRule('.git-history-row')
    const compactRow = lastRule('.git-drawer .git-history-row')
    const graph = lastRule('.git-commit-graph')
    expect(row).toContain('grid-template-columns: auto minmax(0, 1fr) auto')
    expect(compactRow).toContain('grid-template-columns: auto minmax(0, 1fr)')
    expect(graph).toContain('height: 38px')
    expect(css).toContain('--git-lane-0: #5e9cff')
    expect(css).toContain('.git-graph-node')
  })
})

describe('workbench rail and theme integrity CSS', () => {
  it('keeps styles.css structurally balanced so theme.css is never captured by a responsive block', () => {
    const opens = [...css.matchAll(/\{/g)].length
    const closes = [...css.matchAll(/\}/g)].length
    expect(opens).toBe(closes)
  })

  it('removes the extra Agent column when shortcuts use the existing workspace rail', () => {
    const unified = firstRule('.agent-workspace.agent-rail-unified')
    const slot = firstRule('.workspace-agent-rail-slot')
    expect(unified).toContain('grid-template-columns: minmax(320px, var(--agent-chat-width)) 6px minmax(320px, 1fr)')
    expect(unified).not.toContain('var(--agent-tools-width)')
    expect(slot).toContain('flex: 1 1 auto')
    expect(slot).toContain('border-top: 1px solid var(--theme-border)')
  })

  it('keeps the tunnel overview compact and gives the empty state its own hierarchy', () => {
    const modal = lastRule('.tunnel-overview')
    const empty = lastRule('.tunnel-empty')
    expect(modal).toContain('width: min(560px, calc(100vw - 32px))')
    expect(modal).toContain('border-radius: 12px')
    expect(empty).toContain('min-height: 138px')
    expect(empty).toContain('align-content: center')
  })
})
