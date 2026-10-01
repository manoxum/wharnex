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

  it('adds modest Git panel breathing room with a narrow-container override', () => {
    const spacing = read('styles/domains/git/git-panel-spacing.css')
    expect(spacing).toContain('.git-tab-content {\n  padding: 14px;')
    expect(spacing).toContain('padding-inline: 2px;')
    expect(spacing).toContain('@container semantic-panel (max-width: 430px)')
  })
})
