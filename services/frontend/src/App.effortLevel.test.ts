import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const frontendRoot = process.cwd()
const app = fs.readFileSync(path.join(frontendRoot, 'src', 'App.tsx'), 'utf8')
const panel = fs.readFileSync(path.join(frontendRoot, 'src', 'components', 'ChatPanel.tsx'), 'utf8')
const prompt = fs.readFileSync(path.join(frontendRoot, '..', 'backend', 'internal', 'planner', 'prompt.go'), 'utf8')
const api = fs.readFileSync(path.join(frontendRoot, 'src', 'lib', 'api.ts'), 'utf8')
const workspaceMemory = fs.readFileSync(path.join(frontendRoot, 'src', 'lib', 'workspaceMemory.ts'), 'utf8')

describe('composer effort level', () => {
  it('offers every requested effort budget in the chat composer', () => {
    for (const option of ['Low · 3', 'Medium · 8', 'High · 15', 'Extra High · 20', 'Max · 30', 'Ultra · 50', 'Loop · ∞']) {
      expect(panel).toContain(option)
    }
    expect(panel).toContain('aria-label="Nível de esforço"')
  })

  it('defaults new projects and sessions to high effort', () => {
    expect(app).toContain("useState<EffortLevel>('high')")
    expect(api).toContain("effortLevel: EffortLevel = 'high'")
    expect(workspaceMemory).toContain("? value : 'high'")
    expect(workspaceMemory).toContain("catch { return 'high' }")
  })

  it('synchronizes the selected effort with backend sessions', () => {
    expect(app).toContain('api.setEffortLevel')
    expect(app).toContain('onEffortLevel: changeEffortLevel')
  })

  it('treats successful host apply as the terminal boundary', () => {
    expect(prompt).toContain('EFFORT LEVEL CONTRACT — QUALITY/COST BALANCE')
    expect(prompt).toContain('successful host integration is the terminal boundary of the Main Request')
    expect(prompt).toContain('Never propose or expect a post-success continuous-improvement round')
    expect(panel).toContain('após aplicar com sucesso no host, a Main Request termina')
  })
})
