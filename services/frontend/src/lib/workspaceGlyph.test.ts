import { describe, expect, it } from 'vitest'
import { directoryGlyphKind, fileGlyphKind, fileGlyphMark } from './workspaceGlyph'

describe('workspace glyph mapping', () => {
  it('maps common technology directory names to semantic icon groups', () => {
    expect(directoryGlyphKind('build')).toBe('build')
    expect(directoryGlyphKind('tools/scripts')).toBe('scripts')
    expect(directoryGlyphKind('infra/docker')).toBe('docker')
    expect(directoryGlyphKind('api/schemas')).toBe('schema')
    expect(directoryGlyphKind('server/db')).toBe('database')
    expect(directoryGlyphKind('docs')).toBe('docs')
    expect(directoryGlyphKind('unknown-folder')).toBe('folder')
  })

  it('keeps concise technology marks for common source files', () => {
    expect(fileGlyphKind('src/App.tsx')).toBe('typescript')
    expect(fileGlyphMark('src/App.tsx', 'typescript')).toBe('TX')
    expect(fileGlyphKind('compose.yaml')).toBe('docker')
    expect(fileGlyphKind('database/schema.sql')).toBe('database')
  })
})
