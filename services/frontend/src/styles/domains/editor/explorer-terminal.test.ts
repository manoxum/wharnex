import { describe, expect, it } from 'vitest'
import { css, terminalSource, lastRule } from '../../cascade/styleRules'

describe('editor explorer terminal visual consolidation', () => {
  it('uses one flat IDE grammar across the three requested core surfaces', () => {
    expect(css).toContain('/* v1.2.50 — one visual grammar for Editor, Explorer and Terminal.')
    expect(lastRule('.editor-tabbar')).toContain('height: 36px')
    expect(lastRule('.editor-contextbar')).toContain('background: var(--theme-surface)')
    expect(lastRule('.agent-project-tree')).toContain('padding: 4px 0 8px')
    expect(lastRule('.agent-tree-row')).toContain('height: 30px')
    expect(lastRule('.agent-tree-row')).toContain('border-left: 2px solid transparent')
    expect(lastRule('.agent-tree-row.selected-node')).toContain('border-left-color: var(--theme-accent)')
    expect(lastRule('.agent-tree-row.selected-node')).toContain('box-shadow: none')
    expect(lastRule('.terminal-tabbar')).toContain('min-height: 34px')
    expect(lastRule('.terminal-tabs')).toContain('overflow-x: auto')
    expect(lastRule('.terminal-tabs')).toContain('scrollbar-width: none')
    expect(lastRule('.terminal-tab-shell.active')).toContain('box-shadow: inset 0 -2px var(--theme-accent)')
  })

  it('keeps terminal tab editing and actions aligned with desktop IDE chrome', () => {
    expect(lastRule('.terminal-tabbar')).toContain('min-height: 34px')
    expect(lastRule('.terminal-tab-action')).toContain('border-radius: 4px')
    expect(lastRule('.terminal-tab-title')).toContain('flex: 1 1 auto')
    expect(css).not.toContain('.terminal-tab-select > span')
    expect(lastRule('.terminal-tab-edit input')).toContain('height: 25px')
    expect(lastRule('.terminal-tab-edit input')).toContain('font: 500 calc(11px * var(--ui-font-scale))/1 var(--ui-font-family)')
  })

  it('keeps native code and terminal canvases on the same restrained dark surface', () => {
    expect(terminalSource).toContain("background: '#151715'")
    expect(css).toContain('.monaco-editor-host {\n  border: 0;\n  background: #151715;')
    expect(css).toContain('.ide-terminal {\n  border: 0;\n  background: #151715;')
  })
})
