import { describe, expect, it } from 'vitest'
import { buildDiffDocument } from './unifiedDiff'

describe('buildDiffDocument', () => {
  it('reconstructs the complete original file from the current applied file', () => {
    const diff = 'diff --git a/demo.ts b/demo.ts\n--- a/demo.ts\n+++ b/demo.ts\n@@ -1,3 +1,4 @@\n const one = 1\n-const two = 2\n+const two = 20\n+const extra = 3\n export { one, two }\n'
    const current = 'const one = 1\nconst two = 20\nconst extra = 3\nexport { one, two }\n'

    expect(buildDiffDocument(diff, current)).toEqual({
      original: 'const one = 1\nconst two = 2\nexport { one, two }\n',
      modified: current,
      complete: true,
      created: false,
      deleted: false,
    })
  })

  it('reverses multiple sequential patches for the same file', () => {
    const diff = 'diff --git a/demo.txt b/demo.txt\n--- a/demo.txt\n+++ b/demo.txt\n@@ -1 +1 @@\n-one\n+two\n\ndiff --git a/demo.txt b/demo.txt\n--- a/demo.txt\n+++ b/demo.txt\n@@ -1 +1 @@\n-two\n+three\n'
    expect(buildDiffDocument(diff, 'three\n').original).toBe('one\n')
  })

  it('builds complete created and deleted file sides from the patch', () => {
    const created = 'diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n'
    const deleted = 'diff --git a/old.txt b/old.txt\ndeleted file mode 100644\n--- a/old.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-one\n-two\n'

    expect(buildDiffDocument(created, 'one\ntwo\n')).toMatchObject({ original: '', modified: 'one\ntwo\n', complete: true, created: true })
    expect(buildDiffDocument(deleted)).toMatchObject({ original: 'one\ntwo', modified: '', complete: true, deleted: true })
  })

  it('falls back to hunk excerpts when the current file no longer matches the patch', () => {
    const diff = 'diff --git a/demo.txt b/demo.txt\n--- a/demo.txt\n+++ b/demo.txt\n@@ -1 +1 @@\n-old\n+new\n'
    expect(buildDiffDocument(diff, 'changed later\n')).toEqual({ original: 'old', modified: 'new', complete: false, created: false, deleted: false })
  })
})
