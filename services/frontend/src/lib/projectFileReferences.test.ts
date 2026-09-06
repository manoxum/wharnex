import { describe, expect, it } from 'vitest'
import { fileReferenceQuery, matchingProjectFiles, projectFileReferenceSuffix } from './projectFileReferences'

describe('project file references', () => {
  it('recognizes an unfinished @file expression at the caret', () => {
    expect(fileReferenceQuery('revê @file:src/app', 19)).toEqual({ start: 5, end: 19, query: 'src/app' })
  })

  it('ranks matching eligible files and omits selected paths', () => {
    expect(matchingProjectFiles(['src/App.tsx', 'src/app.test.ts', 'docs/app.md'], 'app', ['docs/app.md']))
      .toEqual(['src/App.tsx', 'src/app.test.ts'])
  })

  it('serializes references as canonical prompt tokens', () => {
    expect(projectFileReferenceSuffix(['src/App.tsx'])).toContain('@file:<<src/App.tsx>>')
  })
})
