import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const inspector = readFileSync(resolve(process.cwd(), 'src/components/editor/inspector/Inspector.tsx'), 'utf8')
const resolver = readFileSync(resolve(process.cwd(), 'src/components/editor/inspector/ConflictResolverModal.tsx'), 'utf8')
const app = readFileSync(resolve(process.cwd(), 'src/app/workspace/App.tsx'), 'utf8')

describe('manual conflict resolution surface', () => {
  it('keeps manual and GPT conflict controls while semantic conflicts join bounded automatic recovery', () => {
    expect(inspector).toContain('Resolver manualmente')
    expect(inspector).toContain('Resolver com GPT')
    expect(app).toContain("!['repair_pending', 'baseline_update_pending', 'conflict_resolution_pending'].includes(session.state)")
    expect(app).toContain("session.state === 'conflict_resolution_pending') { if (conflictAutoDispatchable(session)) void submitConflictPrompt(session, targetChat) }")
  })

  it('uses a three-way editable workbench and supports hybrid delegation', () => {
    expect(resolver).toContain('Atual')
    expect(resolver).toContain('Resultado')
    expect(resolver).toContain('Recebido')
    expect(resolver).toContain('Delegar restantes ao GPT')
    expect(resolver).toContain('Marcar edição como resolvida')
    expect(resolver).toContain('api.delegateConflictToGPT')
    expect(resolver).toContain("strategy === 'gpt_only'")
    expect(resolver).toContain('GPT Only · informativo')
  })
})
