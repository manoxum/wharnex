import { describe, expect, it } from 'vitest'
import { editorDisplayLanguage, editorLanguageForPath } from './editorLanguage'

describe('editor language detection', () => {
  it('recognizes source files and special build filenames', () => {
    expect(editorLanguageForPath('src/App.tsx')).toBe('typescript')
    expect(editorLanguageForPath('services/backend/main.go')).toBe('go')
    expect(editorLanguageForPath('Dockerfile')).toBe('dockerfile')
    expect(editorLanguageForPath('Makefile')).toBe('makefile')
    expect(editorLanguageForPath('GNUmakefile')).toBe('makefile')
    expect(editorLanguageForPath('build/rules.mk')).toBe('makefile')
  })

  it('recognizes environment files with their own syntax mode', () => {
    expect(editorLanguageForPath('.env')).toBe('dotenv')
    expect(editorLanguageForPath('.env.local')).toBe('dotenv')
    expect(editorLanguageForPath('config.env')).toBe('dotenv')
    expect(editorDisplayLanguage('.env.production')).toBe('Environment')
  })

  it('falls back without pretending an unknown file has syntax support', () => {
    expect(editorLanguageForPath('notes.custom')).toBe('plaintext')
    expect(editorDisplayLanguage('notes.custom')).toBe('Plain Text')
  })
})
