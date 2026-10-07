import { currentBranch, repositoryLabel, repositoryOutgoing, repositoryRemote, type GitRepositoryOverviewEntry as Entry } from '../../../../lib/git/workflow/gitProjectOverview'

export function visibleChangesRepositories(entries: Entry[]) {
  return entries.filter((entry) => entry.repository.root || hasChanges(entry) || repositoryOutgoing(entry) > 0)
}

function hasChanges(entry: Entry) {
  return Boolean(entry.overview && (!entry.overview.working.clean || entry.overview.working.files.length))
}

export function committablePaths(entry: Entry) {
  return (entry.overview?.working.files || []).filter((file) => file.kind === 'change' || file.kind === 'gitlink').map((file) => file.path)
}

export function childrenFirst(entries: Entry[]) {
  return [...entries].sort((a, b) => b.repository.depth - a.repository.depth || a.repository.path.localeCompare(b.repository.path))
}

export function commitRepositories(entries: Entry[]) {
  const changed = entries.filter((entry) => committablePaths(entry).length)
  return childrenFirst(entries.filter((entry) => changed.includes(entry) || changed.some((child) => isAncestor(entry, child))))
}

function isAncestor(parent: Entry, child: Entry) {
  return parent !== child && (!parent.repository.path || child.repository.path.startsWith(`${parent.repository.path}/`))
}

export function plannedCommitPaths(entry: Entry, plan: Entry[]) {
  const descendants = plan.filter((child) => isAncestor(entry, child))
  const directChildren = descendants.filter((child) => !descendants.some((other) => isAncestor(other, child)))
  const prefix = entry.repository.path ? `${entry.repository.path}/` : ''
  return [...new Set([...committablePaths(entry), ...directChildren.map((child) => child.repository.path.slice(prefix.length))])]
}

export function commitUnavailableReason(entries: Entry[]) {
  for (const entry of entries) {
    const state = entry.overview
    if (!entry.repository.available || !state) return `${repositoryLabel(entry)}: repositório indisponível.`
    if (!state.has_identity) return `${repositoryLabel(entry)}: configure user.name e user.email.`
    if (state.in_progress || state.conflict || state.working.files.some((file) => file.kind === 'unmerged')) return `${repositoryLabel(entry)}: resolva a operação ou o conflito em curso.`
  }
  return ''
}

export function pushUnavailableReason(entries: Entry[]) {
  for (const entry of entries) {
    if (!entry.repository.available || !entry.overview) return `${repositoryLabel(entry)}: repositório indisponível.`
    if (entry.overview.detached || !currentBranch(entry.overview)) return `${repositoryLabel(entry)}: selecione uma branch antes do push.`
    if (!entry.overview.remotes.some((remote) => remote.name === repositoryRemote(entry))) return `${repositoryLabel(entry)}: configure um remoto antes do push.`
    if (entry.overview.in_progress || entry.overview.conflict || entry.overview.working.files.some((file) => file.kind === 'unmerged')) return `${repositoryLabel(entry)}: resolva a operação ou o conflito em curso.`
  }
  return ''
}
