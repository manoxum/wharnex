import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

describe('App restart confirmation recovery', () => {
  it('derives modal presentation from persisted session state instead of only apply responses', () => {
    expect(source).toMatch(/const restartPresentationKey = restartConfirmationKey\(session\)/)
    expect(source).toMatch(/if \(!dismissedRestartKeysRef\.current\.has\(restartPresentationKey\)\) setRestartModalOpen\(true\)/)
    expect(source).not.toMatch(/if \(submission\.restart_required\) setRestartModalOpen\(true\)/)
    expect(source).not.toMatch(/if \(updated\.self_evolution && updated\.state === 'restart_pending'\) setRestartModalOpen\(true\)/)
  })

  it('records Mais tarde for the current activation while keeping manual reopening available', () => {
    expect(source).toMatch(/dismissedRestartKeysRef\.current\.add\(restartPresentationKey\)/)
    expect(source).toMatch(/onLater=\{dismissRestartConfirmation\}/)
    expect(source).toMatch(/onRestartPending=\{\(\) => setRestartModalOpen\(true\)\}/)
  })
})
