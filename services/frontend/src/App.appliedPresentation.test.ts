import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

describe('applied result chat projection', () => {
  it('reconciles host.applied events and hydrated applied sessions into summary and diff items', () => {
    expect(source).toMatch(/parsed\.type === 'host\.applied'/)
    expect(source).toMatch(/setHostAppliedPresentation/)
    expect(source).toMatch(/api\.getSession\(hostAppliedPresentation\.sessionId\)/)
    expect(source).toMatch(/appliedChangePresentationItems\(updated\)/)
    expect(source).toMatch(/mergeAppliedChangePresentationItems/)
    expect(source).toMatch(/session\.last_host_applied_at/)
  })
})
