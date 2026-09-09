import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const frontendRoot = process.cwd()
const app = fs.readFileSync(path.join(frontendRoot, 'src', 'App.tsx'), 'utf8')
const panel = fs.readFileSync(path.join(frontendRoot, 'src', 'components', 'ChatPanel.tsx'), 'utf8')
const prompt = fs.readFileSync(path.join(frontendRoot, '..', 'backend', 'internal', 'planner', 'prompt.go'), 'utf8')

describe('composer effort level', () => {
  it('offers every requested effort budget in the chat composer', () => {
    for (const option of ['Low · 1', 'Medium · 3', 'High · 6', 'Extra High · 10', 'Max · 15', 'Ultra · 30', 'Loop · ∞']) {
      expect(panel).toContain(option)
    }
    expect(panel).toContain('aria-label="Nível de esforço"')
  })

  it('synchronizes the selected effort with backend sessions', () => {
    expect(app).toContain('api.setEffortLevel')
    expect(app).toContain('onEffortLevel: changeEffortLevel')
  })

  it('teaches the planner to stop when further work has poor cost benefit', () => {
    expect(prompt).toContain('EFFORT LEVEL CONTRACT — QUALITY/COST BALANCE')
    expect(prompt).toContain('Never consume attempts merely because they are available')
    expect(prompt).toContain('no meaningful improvement remains')
  })
})
