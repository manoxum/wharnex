import type { ChatChangeFile, ChatChangeSummary, ChatItem, CommandResult, ExecutionPlan, Session } from '../types'

export function buildChangeSummary(plan: ExecutionPlan | undefined, appliedAt = new Date().toISOString(), hostCommands: CommandResult[] = []): ChatChangeSummary | undefined {
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
  if (!values.length && !hostCommands.length) return undefined
  const canRevert = values.length > 0 && plan.operations.every((operation) => operation.type === 'apply_patch')
  return { planId: plan.plan_id, summary: plan.summary?.trim() || undefined, files: values, hostCommands, appliedAt, canRevert }
}

export function appliedChangePresentationItems(session: Session): ChatItem[] {
  const applied = session.last_applied_changes || []
  if (!applied.length) return []
  const latest = applied[applied.length - 1].plan
  const plan: ExecutionPlan = {
    ...latest,
    summary: applied.map((change) => change.plan.summary).filter(Boolean).join(' + '),
    operations: applied.flatMap((change) => change.plan.operations || []),
    verification: applied.flatMap((change) => change.plan.verification || []),
  }
  const appliedAt = session.last_host_applied_at || applied[applied.length - 1].verified_at
  const change = buildChangeSummary(plan, appliedAt, session.last_host_commands || [])
  if (!change) return []
  const identity = `${change.planId}:${change.appliedAt}`
  const items: ChatItem[] = []
  if (session.last_main_request_summary?.trim()) {
    items.push({ id: `host-applied-summary:${identity}`, role: 'harness', source: 'chatgpt', presentation: 'message', createdAt: change.appliedAt, text: session.last_main_request_summary.trim(), meta: 'Resumo cumulativo da Main Request' })
  }
  items.push({ id: `host-applied-change:${identity}`, role: 'harness', source: 'wharness', presentation: 'change', createdAt: change.appliedAt, text: 'Alterações e comandos aplicados ao host.', change })
  return items
}

export function mergeAppliedChangePresentationItems(current: ChatItem[], projected: ChatItem[]) {
  if (!projected.length) return current
  const summary = projected.find((item) => item.presentation === 'message')
  const change = projected.find((item) => item.presentation === 'change')
  const planId = change?.change?.planId
  const appliedAt = change?.change?.appliedAt
  const lastUserIndex = current.reduce((latest, item, index) => item.role === 'user' ? index : latest, -1)
  // Recompose the terminal result as one package. Older versions appended the
  // turn message, diff and cumulative summary independently, so a reload could
  // preserve both GPT messages and strand the diff before the summary.
  const next = current.filter((item, index) => {
    if (projected.some((candidate) => candidate.id === item.id)) return false
    if (item.presentation === 'change' && planId && item.change?.planId === planId && item.change?.appliedAt === appliedAt) return false
    if (summary && item.meta === summary.meta && item.text.trim() === summary.text.trim()) return false
    if (summary && planId && index > lastUserIndex && item.source === 'chatgpt' && item.meta?.includes('Host aplicado')) return false
    return true
  })
  if (summary) next.push(summary)
  if (change) next.push(change)
  return next
}

export function splitPatchByFile(patch: string): ChatChangeFile[] {
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
