import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { css, lastRule } from '../../../cascade/styleRules'

describe('workspace readability and Git focus CSS', () => {
  it('routes every legacy micro font at or below 10px through the UI scale', () => {
    const directSmall = [...css.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g)].filter((match) => Number(match[1]) <= 10)
    const shorthandSmall = [...css.matchAll(/font\s*:\s*([^;]+);/g)].filter((match) => {
      if (match[1].includes('var(--ui-font-scale)')) return false
      const size = match[1].match(/(?:^|\s)(\d+(?:\.\d+)?)px/)
      return Boolean(size && Number(size[1]) <= 10)
    })
    expect(directSmall).toEqual([])
    expect(shorthandSmall).toEqual([])
  })

  it('keeps Git file state visible in Explorer and Editor without relying on colour alone', () => {
    const explorer = readFileSync(resolve(process.cwd(), 'src/components/agent/explorer/AgentProjectExplorer.tsx'), 'utf8')
    const tree = readFileSync(resolve(process.cwd(), 'src/components/agent/explorer/ProjectExplorerTree.tsx'), 'utf8')
    expect(explorer).toContain('text-[calc(9px*var(--ui-font-scale))]')
    expect(tree).toContain('agent-tree-git-status inline-flex')
    expect(tree).toContain('statusTone[file.status]')
    expect(lastRule('.editor-git-file-state')).toContain('display: inline-flex')
    expect(tree).toContain('git-${file.status}')
    expect(tree).toContain('<GitChangeBadge file={file}/>')
  })
})
