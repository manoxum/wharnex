export type EditorGitChangeKind = 'added' | 'modified' | 'deleted'

export type EditorGitChange = {
  id: string
  kind: EditorGitChangeKind
  startLine: number
  endLine: number
  anchorLine: number
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  diff: string
}

type DiffSection = {
  oldPath: string
  newPath: string
  hunks: Array<{ oldStart: number; oldCount: number; newStart: number; newCount: number; lines: string[] }>
}

export function parseEditorGitChanges(diff: string, path: string): EditorGitChange[] {
  const changes: EditorGitChange[] = []
  for (const section of parseSections(diff, path)) {
    section.hunks.forEach((hunk, hunkIndex) => {
      let oldLine = hunk.oldStart
      let newLine = hunk.newStart
      let runOldStart = oldLine
      let runNewStart = newLine
      let runOldCount = 0
      let runNewCount = 0
      let runLines: string[] = []
      let runIndex = 0

      const flush = () => {
        if (!runLines.length || (!runOldCount && !runNewCount)) return
        const kind: EditorGitChangeKind = runOldCount && runNewCount ? 'modified' : runNewCount ? 'added' : 'deleted'
        const anchorLine = Math.max(1, runNewStart)
        const startLine = runNewCount ? Math.max(1, runNewStart) : anchorLine
        const endLine = runNewCount ? Math.max(startLine, runNewStart + runNewCount - 1) : anchorLine
        const header = `@@ -${runOldStart},${runOldCount} +${runNewStart},${runNewCount} @@`
        changes.push({
          id: `${hunkIndex}:${runIndex}:${runOldStart}:${runNewStart}:${kind}`,
          kind,
          startLine,
          endLine,
          anchorLine,
          oldStart: runOldStart,
          oldCount: runOldCount,
          newStart: runNewStart,
          newCount: runNewCount,
          diff: [
            `diff --git a/${path} b/${path}`,
            `--- ${section.oldPath}`,
            `+++ ${section.newPath}`,
            header,
            ...runLines,
            '',
          ].join('\n'),
        })
        runIndex += 1
        runLines = []
        runOldCount = 0
        runNewCount = 0
      }

      for (const line of hunk.lines) {
        if (line.startsWith(' ')) {
          flush()
          oldLine += 1
          newLine += 1
          continue
        }
        if (line === '\\ No newline at end of file') {
          if (runLines.length) runLines.push(line)
          continue
        }
        if (!runLines.length) {
          runOldStart = oldLine
          runNewStart = newLine
        }
        runLines.push(line)
        if (line.startsWith('-')) {
          runOldCount += 1
          oldLine += 1
        } else if (line.startsWith('+')) {
          runNewCount += 1
          newLine += 1
        }
      }
      flush()
    })
  }
  return changes
}

function parseSections(diff: string, path: string): DiffSection[] {
  const normalized = diff.replace(/\r\n/g, '\n')
  const blocks = normalized.split(/(?=^diff --git )/m).filter((block) => block.trim())
  const candidates = blocks.length ? blocks : [normalized]
  return candidates.map((block) => parseSection(block, path)).filter((section) => section.hunks.length > 0)
}

function parseSection(block: string, path: string): DiffSection {
  const lines = block.split('\n')
  const oldPath = /^---\s+(.+)$/m.exec(block)?.[1]?.trim() || `a/${path}`
  const newPath = /^\+\+\+\s+(.+)$/m.exec(block)?.[1]?.trim() || `b/${path}`
  const hunks: DiffSection['hunks'] = []
  let current: DiffSection['hunks'][number] | undefined

  for (const line of lines) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (match) {
      current = {
        oldStart: Number(match[1]),
        oldCount: Number(match[2] ?? 1),
        newStart: Number(match[3]),
        newCount: Number(match[4] ?? 1),
        lines: [],
      }
      hunks.push(current)
      continue
    }
    if (current && (/^[ +-]/.test(line) || line === '\\ No newline at end of file')) current.lines.push(line)
  }
  return { oldPath, newPath, hunks }
}
