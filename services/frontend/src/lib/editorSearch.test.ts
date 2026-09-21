import { describe, expect, it } from 'vitest'
import type { FileEntry } from '../types'
import { rankWorkspaceFiles } from './editorSearch'

const files: FileEntry[] = [
  { path: 'src/components/EditorWorkspace.tsx', name: 'EditorWorkspace.tsx', kind: 'file', size: 1 },
  { path: 'services/backend/search.go', name: 'search.go', kind: 'file', size: 1 },
  { path: 'docs', name: 'docs', kind: 'directory', size: 0 },
]

describe('rankWorkspaceFiles', () => {
  it('prioritizes exact/prefix matches and supports subsequence abbreviations', () => {
    expect(rankWorkspaceFiles(files, 'search')[0]?.path).toBe('services/backend/search.go')
    expect(rankWorkspaceFiles(files, 'edws')[0]?.path).toBe('src/components/EditorWorkspace.tsx')
  })

  it('does not return directories', () => {
    expect(rankWorkspaceFiles(files, '').map((file) => file.path)).not.toContain('docs')
  })
})
