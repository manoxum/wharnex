type Hunk = {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: string[]
}

type PatchSection = {
  oldPath: string
  newPath: string
  hunks: Hunk[]
}

export type DiffDocument = {
  original: string
  modified: string
  complete: boolean
  created: boolean
  deleted: boolean
}

export function buildDiffDocument(diff: string, currentContent?: string): DiffDocument {
  const sections = parseSections(diff)
  const first = sections[0]
  const last = sections[sections.length - 1]
  const created = first?.oldPath === '/dev/null'
  const deleted = last?.newPath === '/dev/null'

  if (currentContent !== undefined && !deleted) {
    const original = reverseSections(currentContent, sections)
    if (original !== undefined) return { original, modified: currentContent, complete: true, created, deleted }
  }

  const fragments = fragmentDocument(sections)
  return {
    ...fragments,
    complete: Boolean((created && !deleted) || deleted),
    created,
    deleted,
  }
}

function parseSections(diff: string): PatchSection[] {
  const normalized = diff.replace(/\r\n/g, '\n')
  const blocks = normalized.split(/(?=^diff --git )/m).filter((block) => block.trim())
  return blocks.map(parseSection).filter((section) => section.hunks.length > 0)
}

function parseSection(block: string): PatchSection {
  const lines = block.split('\n')
  const oldPath = /^---\s+(.+)$/m.exec(block)?.[1]?.trim().replace(/^a\//, '') || ''
  const newPath = /^\+\+\+\s+(.+)$/m.exec(block)?.[1]?.trim().replace(/^b\//, '') || ''
  const hunks: Hunk[] = []
  let current: Hunk | undefined

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
    if (current && (/^[ +\\-]/.test(line) || line === '\\ No newline at end of file')) current.lines.push(line)
  }
  return { oldPath, newPath, hunks }
}

function reverseSections(currentContent: string, sections: PatchSection[]) {
  let content = currentContent
  for (let sectionIndex = sections.length - 1; sectionIndex >= 0; sectionIndex -= 1) {
    const reversed = reverseSection(content, sections[sectionIndex])
    if (reversed === undefined) return undefined
    content = reversed
  }
  return content
}

function reverseSection(currentContent: string, section: PatchSection) {
  if (section.newPath === '/dev/null') return fragmentSide(section.hunks, 'old')
  if (section.oldPath === '/dev/null') return ''

  const trailingNewline = currentContent.endsWith('\n')
  const lines = splitContent(currentContent)
  const hunks = [...section.hunks].sort((a, b) => b.newStart - a.newStart)

  for (const hunk of hunks) {
    const nextLines = sideLines(hunk, 'new')
    const previousLines = sideLines(hunk, 'old')
    const start = Math.max(0, hunk.newStart - 1)
    const actual = lines.slice(start, start + hunk.newCount)
    if (!sameLines(actual, nextLines)) return undefined
    lines.splice(start, hunk.newCount, ...previousLines)
  }
  return joinContent(lines, trailingNewline)
}

function fragmentDocument(sections: PatchSection[]) {
  const original: string[] = []
  const modified: string[] = []
  sections.forEach((section, sectionIndex) => {
    if (sectionIndex) {
      original.push('⋯')
      modified.push('⋯')
    }
    section.hunks.forEach((hunk, hunkIndex) => {
      if (hunkIndex) {
        original.push('⋯')
        modified.push('⋯')
      }
      original.push(...sideLines(hunk, 'old'))
      modified.push(...sideLines(hunk, 'new'))
    })
  })
  return { original: original.join('\n'), modified: modified.join('\n') }
}

function fragmentSide(hunks: Hunk[], side: 'old' | 'new') {
  return hunks.flatMap((hunk) => sideLines(hunk, side)).join('\n')
}

function sideLines(hunk: Hunk, side: 'old' | 'new') {
  const accepted = side === 'old' ? new Set([' ', '-']) : new Set([' ', '+'])
  return hunk.lines.filter((line) => line !== '\\ No newline at end of file' && accepted.has(line[0])).map((line) => line.slice(1))
}

function splitContent(content: string) {
  if (!content) return []
  const normalized = content.replace(/\r\n/g, '\n')
  return (normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized).split('\n')
}

function joinContent(lines: string[], trailingNewline: boolean) {
  if (!lines.length) return ''
  return `${lines.join('\n')}${trailingNewline ? '\n' : ''}`
}

function sameLines(actual: string[], expected: string[]) {
  return actual.length === expected.length && actual.every((line, index) => line === expected[index])
}
