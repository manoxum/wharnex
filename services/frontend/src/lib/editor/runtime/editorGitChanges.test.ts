import { describe, expect, it } from 'vitest'
import { parseEditorGitChanges } from './editorGitChanges'

describe('parseEditorGitChanges', () => {
  it('groups adjacent changed lines and keeps separated edits independent', () => {
    const diff = [
      'diff --git a/src/demo.ts b/src/demo.ts',
      '--- a/src/demo.ts',
      '+++ b/src/demo.ts',
      '@@ -2,7 +2,8 @@',
      ' keep one',
      '-old two',
      '+new two',
      '+new three',
      ' keep four',
      ' keep five',
      '-old six',
      '+new six',
      ' keep seven',
      '',
    ].join('\n')

    const changes = parseEditorGitChanges(diff, 'src/demo.ts')
    expect(changes).toHaveLength(2)
    expect(changes[0]).toMatchObject({ kind: 'modified', startLine: 3, endLine: 4, oldCount: 1, newCount: 2 })
    expect(changes[0].diff).toContain('@@ -3,1 +3,2 @@')
    expect(changes[0].diff).toContain('-old two\n+new two\n+new three')
    expect(changes[1]).toMatchObject({ kind: 'modified', startLine: 7, endLine: 7, oldCount: 1, newCount: 1 })
    expect(changes[1].diff).not.toContain('new two')
  })

  it('marks pure additions and anchors deletions to the current-side line', () => {
    const diff = [
      'diff --git a/demo.txt b/demo.txt',
      '--- a/demo.txt',
      '+++ b/demo.txt',
      '@@ -1,4 +1,4 @@',
      ' first',
      '+inserted',
      ' second',
      '-removed',
      ' fourth',
      '',
    ].join('\n')

    const changes = parseEditorGitChanges(diff, 'demo.txt')
    expect(changes[0]).toMatchObject({ kind: 'added', startLine: 2, endLine: 2, newCount: 1 })
    expect(changes[1]).toMatchObject({ kind: 'deleted', anchorLine: 4, startLine: 4, endLine: 4, newCount: 0, oldCount: 1 })
    expect(changes[1].diff).toContain('@@ -3,1 +4,0 @@')
  })
})
