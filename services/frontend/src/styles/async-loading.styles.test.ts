import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { styleImportPaths } from './cascade/styleImportPaths'
import { readStyleSource } from './cascade/readStyleSource'

const read = (relative: string) => fs.readFileSync(path.resolve(process.cwd(), 'src', relative), 'utf8')

describe('async loading styling architecture', () => {
  it('imports loading and Git spacing styles through the extensible style index', () => {
    const styles = styleImportPaths('styles/index.css')
    expect(styles).toContain('styles/base/async-loading.css')
    expect(styles).toContain('styles/domains/git/git-panel-spacing.css')
  })

  it('keeps shared skeleton rules outside the frozen legacy root stylesheet', () => {
    const loading = read('styles/base/async-loading.css')
    const legacy = readStyleSource('styles/legacy/styles.css')

    expect(loading).toContain('.async-content-skeleton')
    expect(loading).toContain('.editor-surface-skeleton')
    expect(loading).toContain('@media (prefers-reduced-motion: reduce)')
    expect(legacy).not.toContain('.panel-skeleton {')
    expect(legacy).not.toContain('.chat-entry-skeleton {')
  })

  it('leaves Git tab width and vertical spacing to Tailwind utilities', () => {
    const spacing = read('styles/domains/git/git-panel-spacing.css')
    const content = read('components/git/review/presentation/GitTabContent.tsx')
    expect(content).toContain('w-full px-0 py-2')
    expect(spacing).not.toMatch(/\.git-tab-content\s*\{[^}]*padding(?:-[a-z]+)?\s*:/s)
  })
})
