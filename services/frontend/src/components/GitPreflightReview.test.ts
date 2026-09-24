import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const drawer = readFileSync(resolve(process.cwd(), 'src/components/GitDrawer.tsx'), 'utf8')
const modal = readFileSync(resolve(process.cwd(), 'src/components/GitOperationModal.tsx'), 'utf8')
const api = readFileSync(resolve(process.cwd(), 'src/lib/api.ts'), 'utf8')
const flow = readFileSync(resolve(process.cwd(), 'src/lib/useGitOperationFlow.ts'), 'utf8')

describe('Git preflight review', () => {
  it('reviews commit, push, pull and merge before running the mutation', () => {
    expect(api).toContain('/git/preview')
    expect(drawer).toContain("operation: 'commit'")
    expect(drawer).toContain("operation: 'push'")
    expect(drawer).toContain("operation: 'pull'")
    expect(drawer).toContain("operation: 'merge'")
    expect(flow).toContain("phase: 'reviewing'")
    expect(flow).toMatch(/const previews = await preview\(\)\s+[\s\S]*?setWorking\(false\)\s+[\s\S]*?phase: 'reviewing'/)
  })

  it('presents per-file side-by-side diffs and requires confirmation', () => {
    expect(modal).toContain('Revisão antes de executar')
    expect(modal).toContain('GitDiffReview')
    expect(modal).toContain('fragmentOnly')
    expect(modal).toContain('Confirmar e continuar')
    expect(modal).toContain('preview.from_label')
    expect(modal).toContain('preview.to_label')
  })
})
