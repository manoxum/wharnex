import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const inspector = readFileSync(resolve(process.cwd(), 'src/components/Inspector.tsx'), 'utf8')
const resolver = readFileSync(resolve(process.cwd(), 'src/components/ConflictResolverModal.tsx'), 'utf8')
const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

describe('manual conflict resolution surface', () => {
  it('keeps manual and GPT conflict controls while semantic conflicts join bounded automatic recovery', () => {
    expect(inspector).toContain('Resolver manualmente')
    expect(inspector).toContain('Resolver com GPT')
    expect(app).toContain("!['repair_pending', 'baseline_update_pending', 'conflict_resolution_pending'].includes(session.state)")
    expect(app).toContain("session.state === 'conflict_resolution_pending') void submitConflictPrompt(session, targetChat)")
  })

  it('uses a three-way editable workbench and supports hybrid delegation', () => {
    expect(resolver).toContain('Atual')
    expect(resolver).toContain('Resultado')
    expect(resolver).toContain('Recebido')
    expect(resolver).toContain('Delegar restantes ao GPT')
    expect(resolver).toContain('Marcar edição como resolvida')
    expect(resolver).toContain('api.delegateConflictToGPT')
  })
})
