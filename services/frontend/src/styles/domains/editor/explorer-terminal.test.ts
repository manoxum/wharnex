import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tabBarSource, tabButtonSource, terminalTabsSource } from '../../cascade/tabStyles'
import { describe, expect, it } from 'vitest'
import { css, terminalSource, lastRule } from '../../cascade/styleRules'

describe('editor explorer terminal visual consolidation', () => {
  it('uses one flat IDE grammar across the three requested core surfaces', () => {
    const explorer = readFileSync(resolve(process.cwd(), 'src/components/agent/explorer/ProjectExplorerTree.tsx'), 'utf8')
    const editorContext = readFileSync(resolve(process.cwd(), 'src/components/editor/canvas/context/EditorContextBar.tsx'), 'utf8')
    expect(css).toContain('/* v1.2.50 — one visual grammar for Editor, Explorer and Terminal.')
    expect(tabBarSource).toContain('min-h-10')
    expect(editorContext).toContain('border-b border-whx-border-soft bg-whx-surface')
    expect(editorContext).toContain('aria-label="Ações do ficheiro"')
    expect(explorer).toContain('agent-project-tree min-h-0 flex-1 overflow-auto bg-whx-bg')
    expect(explorer).toContain('h-[28px]')
    expect(explorer).toContain('border-l-[color:var(--theme-tab-active)]')
    expect(explorer).toContain('bg-whx-selection')
    expect(explorer).toContain('data-selected={selected}')
    expect(tabBarSource).toContain('min-h-10')
    expect(tabBarSource).toContain('overflow-x-auto')
    expect(tabBarSource).toContain('[scrollbar-width:none]')
    expect(tabButtonSource).toContain('aria-selected:after:bg-[var(--theme-tab-active)]')
  })

  it('keeps terminal tab editing and actions aligned with desktop IDE chrome', () => {
    expect(tabBarSource).toContain('min-h-10')
    expect(terminalTabsSource).toContain('rounded-[4px]')
    expect(terminalTabsSource).toContain('h-[34px]')
    expect(terminalTabsSource).toContain('min-w-0')
    expect(terminalTabsSource).toContain('max-w-[240px]')
    expect(tabButtonSource).toContain('calc(10.2px*var(--ui-font-scale))')
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
