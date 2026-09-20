import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const chatPanel = readFileSync(resolve(process.cwd(), 'src/components/ChatPanel.tsx'), 'utf8')
const referenceStrip = readFileSync(resolve(process.cwd(), 'src/components/ComposerReferenceStrip.tsx'), 'utf8')
const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')

describe('composer reference candidate replay', () => {
  it('keeps the retained reference strip wired into the composer exactly once', () => {
    expect(chatPanel.match(/import \{ ComposerReferenceStrip \} from '\.\/ComposerReferenceStrip'/g) ?? []).toHaveLength(1)
    expect(chatPanel.match(/<ComposerReferenceStrip\b/g) ?? []).toHaveLength(1)
    expect(referenceStrip).toContain('export function ComposerReferenceStrip')
  })

  it.each(['todo', 'ref', 'lib', 'attach', 'file', 'chat', 'see'])('keeps the distinct %s thumbnail treatment', (kind) => {
    expect(styles).toContain(`.composer-reference-thumbnail.kind-${kind}`)
  })
})
