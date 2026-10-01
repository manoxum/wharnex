import { describe, expect, it } from 'vitest'
import { css, operationalCss, terminalSource, lastRule, lastRuleIn } from '../../../cascade/styleRules'

describe('final workbench visual consolidation', () => {
  it('keeps the late operational stylesheet flat instead of restoring nested cards', () => {
    const runtimeSummary = lastRuleIn(operationalCss, '.agent-runtime-summary span,\n.agent-runtime-memory-summary span')
    const runtimeDetail = lastRuleIn(operationalCss, '.agent-runtime-list,\n.agent-runtime-detail')
    const taskCard = lastRuleIn(operationalCss, '.agent-archive-item,\n.chat-agent-task-card')
    const knowledgeActive = lastRuleIn(operationalCss, '.project-knowledge-index button.active')

    expect(operationalCss).toContain('/* Final IDE tool-window grammar: flat lists, separators and quiet state accents. */')
    expect(runtimeSummary).toContain('border-radius: 0')
    expect(runtimeSummary).toContain('box-shadow: none')
    expect(runtimeDetail).toContain('background: transparent')
    expect(taskCard).toContain('border-bottom: 1px solid var(--theme-border-soft)')
    expect(taskCard).toContain('box-shadow: none')
    expect(knowledgeActive).toContain('border-left-color: var(--theme-accent)')
  })

  it('uses the restrained semantic palette in the native terminal', () => {
    expect(terminalSource).toContain("foreground: '#D8DDD7'")
    expect(terminalSource).toContain("cursor: '#9FCB73'")
    expect(terminalSource).toContain("red: '#E27676'")
    expect(terminalSource).toContain("yellow: '#D8BB70'")
    expect(terminalSource).toContain("blue: '#7DA7D9'")
    expect(terminalSource).toContain("cyan: '#71B7B0'")
    expect(terminalSource).toContain("magenta: '#B58AC9'")
  })

  it('keeps the final workbench chrome compact and semantically quiet', () => {
    expect(css).toContain('.workspace-topbar {\n  height: 44px;')
    expect(lastRule('.mode-switch')).toContain('background: transparent')
    expect(lastRule('.error-toast')).toContain('border-left: 2px solid var(--danger)')
    expect(lastRule('.app-dialog-card')).toContain('border-radius: 8px')
    expect(lastRule('.topbar-indicator')).toContain('width: 27px')
    expect(lastRule('.topbar-indicator')).toContain('border-color: transparent')
  })
})
