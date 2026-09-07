import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')

function lastRule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
  return matches.at(-1)?.[1] || ''
}

function firstRule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  return match?.[1] || ''
}

describe('chat header CSS', () => {
  it('keeps the active chat header fixed while the transcript scrolls', () => {
    const header = lastRule('.chat-header')
    const stream = lastRule('.chat-stream')
    expect(header).toContain('position: sticky')
    expect(header).toContain('top: 0')
    expect(header).toContain('z-index: 12')
    expect(stream).toContain('overflow: auto')
  })
})

describe('composer layout CSS', () => {
  it('uses the whole top composer edge as the vertical resize handle', () => {
    const composer = lastRule('.composer')
    const handle = lastRule('.composer-resize-handle')

    expect(composer).toContain('position: relative')
    expect(composer).toContain('resize: none')
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

describe('split Agent layout CSS', () => {
  it('uses a persistent resizable chat/inspector split with a shared chat strip', () => {
    const splitLayout = css.slice(css.lastIndexOf('/* v1.2.42'))
    expect(splitLayout).toContain('--agent-chat-width: 60vw')
    expect(splitLayout).toContain('grid-template-columns: 42px minmax(320px, var(--agent-chat-width)) 6px minmax(320px, 1fr)')
    expect(splitLayout).toContain('grid-template-rows: 42px 42px minmax(0, 1fr)')
    expect(splitLayout).toContain('grid-template-columns: auto minmax(0, 1fr) auto auto')
    expect(splitLayout).toContain('.agent-chat-switcher { grid-column: 1 / -1')
    expect(splitLayout).toContain('.agent-chat-stage { grid-column: 2; padding-left: 0')
    expect(splitLayout).toContain('.agent-inspector-stage { grid-column: 4')
    expect(splitLayout).toContain('.agent-splitter { grid-column: 3')
    expect(splitLayout).toContain('cursor: col-resize')
    expect(splitLayout).toContain('.agent-drawer { grid-column: 2; grid-row: 3; position: relative')
    expect(lastRule('.topbar-indicator')).toContain('width: 27px')
  })
})
