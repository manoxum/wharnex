import type { FileEntry } from '../../../types'

export function rankWorkspaceFiles(files: FileEntry[], rawQuery: string, limit = 80): FileEntry[] {
  const query = rawQuery.trim().toLowerCase()
  const candidates = files.filter((file) => file.kind === 'file')
  if (!query) return candidates.slice(0, limit)
  return candidates
    .map((file) => ({ file, score: pathMatchScore(file.path.toLowerCase(), query) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => a.score - b.score || a.file.path.localeCompare(b.file.path))
    .slice(0, limit)
    .map((item) => item.file)
}

function pathMatchScore(path: string, query: string) {
  const leaf = path.split('/').pop() || path
  if (leaf === query) return 0
  if (leaf.startsWith(query)) return 5 + leaf.length - query.length
  const leafIndex = leaf.indexOf(query)
  if (leafIndex >= 0) return 20 + leafIndex * 2 + leaf.length - query.length
  const pathIndex = path.indexOf(query)
  if (pathIndex >= 0) return 60 + pathIndex + path.length - query.length

  const parts = query.split(/\s+/).filter(Boolean)
  if (parts.length > 1) {
    const scores = parts.map((part) => subsequenceScore(path, part))
    if (scores.every(Number.isFinite)) return 90 + scores.reduce((sum, value) => sum + value, 0)
  }
  const subsequence = subsequenceScore(leaf, query)
  if (Number.isFinite(subsequence)) return 120 + subsequence
  const pathSubsequence = subsequenceScore(path, query)
  return Number.isFinite(pathSubsequence) ? 180 + pathSubsequence : Number.POSITIVE_INFINITY
}

function subsequenceScore(value: string, query: string) {
  let cursor = 0
  let score = 0
  let previous = -1
  for (const character of query) {
    const index = value.indexOf(character, cursor)
    if (index < 0) return Number.POSITIVE_INFINITY
    score += previous < 0 ? index : Math.max(0, index - previous - 1) * 3
    previous = index
    cursor = index + 1
  }
  return score + Math.max(0, value.length - query.length) * 0.15
}
