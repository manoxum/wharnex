import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Monaco build surface', () => {
  it('loads the precompiled local runtime instead of bundling Monaco sources', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/monaco.ts'), 'utf8')

    expect(source.match(/import \* as monaco from ['"]monaco-editor['"]/)).toBeNull()
    expect(source).not.toContain('?worker')
    expect(source).toContain("['vs/editor/editor.main']")
    expect(source).toContain("defineTheme('wharness-light'")
    expect(source).toContain("defineTheme('wharness-dark'")

    const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8')
    expect(viteConfig).toContain('monaco-editor/min/vs')
    expect(viteConfig).toContain("resolve(outputDirectory, 'monaco/vs')")
  })
})
