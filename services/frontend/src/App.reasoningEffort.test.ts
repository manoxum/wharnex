import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const frontendRoot = process.cwd()
const app = fs.readFileSync(path.join(frontendRoot, 'src', 'App.tsx'), 'utf8')
const panel = fs.readFileSync(path.join(frontendRoot, 'src', 'components', 'ChatPanel.tsx'), 'utf8')

describe('per-chat reasoning effort', () => {
  it('offers only the effort choices observed in the ChatGPT composer', () => {
    expect(panel).toContain('aria-label="Esforço de raciocínio"')
    for (const option of ['Instantâneo', 'Médio', 'Elevado']) expect(panel).toContain(option)
    expect(panel).not.toContain('<option value="light">')
  })

  it('persists one session without synchronizing peer chats', () => {
    const implementation = app.slice(app.indexOf('async function changeReasoningEffort'), app.indexOf('// Chat transport is genuinely per-chat'))
    expect(implementation).toContain('api.setReasoningEffort(session.id, next)')
    expect(implementation).not.toContain('Promise.allSettled')
  })

  it('carries the selected effort into initial, continuation, and comment transport', () => {
    expect(app.match(/reasoningEffort:/g)?.length).toBeGreaterThanOrEqual(3)
    expect(app).toContain("response.session.reasoning_effort || 'high'")
    expect(app).toContain("promptSession.reasoning_effort || 'high'")
    expect(app).toContain("session.reasoning_effort || 'high'")
  })
})
