import type { ChatChangeFile, ChatChangeSummary, ExecutionPlan } from '../types'

export function buildChangeSummary(plan: ExecutionPlan | undefined, appliedAt = new Date().toISOString()): ChatChangeSummary | undefined {
  if (!plan) return undefined
  const files = new Map<string, ChatChangeFile>()
  for (const operation of plan.operations) {
    if (operation.type !== 'apply_patch' || !operation.patch.trim()) continue
    for (const part of splitPatchByFile(operation.patch)) {
      const current = files.get(part.path)
      if (current) {
        current.additions += part.additions
        current.deletions += part.deletions
        current.diff += `\n${part.diff}`
      } else files.set(part.path, part)
    }
  }
  const values = [...files.values()]
  if (!values.length) return undefined
  const canRevert = plan.operations.every((operation) => operation.type === 'apply_patch')
  return { planId: plan.plan_id, files: values, appliedAt, canRevert }
}

function splitPatchByFile(patch: string): ChatChangeFile[] {
  const lines = patch.replace(/\r\n/g, '\n').split('\n')
  const starts: number[] = []
  lines.forEach((line, index) => { if (line.startsWith('diff --git ') || (line.startsWith('--- ') && index === 0)) starts.push(index) })
  if (!starts.length) starts.push(0)
  const chunks = starts.map((start, index) => lines.slice(start, starts[index + 1] ?? lines.length).join('\n')).filter(Boolean)
  return chunks.flatMap((diff) => {
    const path = patchPath(diff)
    if (!path) return []
    let additions = 0, deletions = 0
    for (const line of diff.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions += 1
      else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1
    }
    return [{ path, additions, deletions, diff }]
  })
}

function patchPath(diff: string) {
  const plus = /^\+\+\+\s+(?:b\/)?(.+)$/m.exec(diff)?.[1]?.trim()
  if (plus && plus !== '/dev/null') return plus
  const minus = /^---\s+(?:a\/)?(.+)$/m.exec(diff)?.[1]?.trim()
  if (minus && minus !== '/dev/null') return minus
  const git = /^diff --git a\/(.+?) b\/(.+)$/m.exec(diff)
  return git?.[2]?.trim() || git?.[1]?.trim() || ''
}
