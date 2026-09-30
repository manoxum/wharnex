import { describe, expect, it } from 'vitest'
import { lastRule } from '../../../cascade/styleRules'

describe('workbench visual hierarchy CSS', () => {
  it('gives the focused pane a quiet accent without unmounting adjacent surfaces', () => {
    const chatFocus = lastRule(".agent-workspace[data-focused-pane='chat']:not(.single-pane) .agent-chat-stage")
    const inspectorFocus = lastRule(".agent-workspace[data-focused-pane='inspector']:not(.single-pane) .agent-inspector-stage")
    const directChatGPT = lastRule(".agent-workspace.agent-rail-unified[data-focused-pane='inspector'][data-inspector-tab='direct-chatgpt']:not(.single-pane)")

    expect(chatFocus).toContain('inset 0 2px')
    expect(inspectorFocus).toContain('inset 0 2px')
    expect(directChatGPT).toContain('--agent-chat-width: calc((100% - 6px) * 0.4)')
  })

  it('flattens repeated database cards into separator-led sections', () => {
    const databaseSection = lastRule('.database-connection-section')

    expect(databaseSection).toContain('border-radius: 0')
    expect(databaseSection).toContain('background: transparent')
  })

  it('turns execution history into a light timeline and keeps scroll chrome subtle', () => {
    const timeline = lastRule('.execution-timeline')
    const thumb = lastRule('.workspace-body *::-webkit-scrollbar-thumb')

    expect(timeline).toContain('border-left: 1px solid var(--theme-border-soft)')
    expect(timeline).toContain('background: transparent')
    expect(thumb).toContain('border-radius: 999px')
    expect(thumb).toContain('background-clip: padding-box')
  })
})
