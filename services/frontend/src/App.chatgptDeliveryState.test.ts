import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const frontendRoot = process.cwd()
const app = fs.readFileSync(path.join(frontendRoot, 'src', 'App.tsx'), 'utf8')

describe('ChatGPT delivery state reconciliation', () => {
  it('clears a stale retry delivery when the same request is visibly reasoning', () => {
    expect(app).toContain("activity.state === 'thinking' && activity.requestId")
    expect(app).toContain("current[active.id]?.requestId !== activity.requestId")
    expect(app).toContain("failedPromptDeliveryKeysRef.current.delete(key)")
  })

  it('does not resend a request Desktop is already supervising', () => {
    expect(app).toContain('if (prepared.alreadySupervised)')
    expect(app).toContain('nenhum reenvio foi feito')
    expect(app).toContain('Aguardando resposta do ChatGPT')
  })
})
