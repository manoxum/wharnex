import { WorkbenchTabs } from '../../presentation/tabs'
import type { GitOverview } from '../../../types'
import { translate as uiText } from '../../../lib/workspace/localization'
export type GitTab = 'changes' | 'history' | 'contributors' | 'branches' | 'settings'
export type GitChangesTab = 'working' | 'pending'
export function GitTabs({ active, onChange, overview }: { active: GitTab; onChange: (tab: GitTab) => void; overview: GitOverview }) {
  const current = overview.branches.find((branch) => !branch.remote && branch.current)
  const unpublished = current?.has_upstream && !current.gone ? current.ahead : overview.commits.filter((commit) => !commit.pushed).length
  const changes = (overview.working.files?.length || overview.working.stageable_count) + unpublished
  return <WorkbenchTabs label={uiText('Secções do Git')} value={active} onChange={onChange} className="min-h-9 shrink-0 border-b border-whx-border-soft bg-whx-side px-1 [&>[data-workbench-tab]]:!min-h-9 [&>[data-workbench-tab]]:!text-[length:calc(11px*var(--ui-font-scale))]" items={[
    { id: 'changes', label: uiText('Alterações'), icon: 'edit', badge: changes },
    { id: 'history', label: uiText('Histórico'), icon: 'git', badge: overview.commits.length },
    { id: 'contributors', label: uiText('Contribuidores'), icon: 'agent' },
    { id: 'branches', label: 'Branches', icon: 'bridge', badge: overview.branches.length },
    { id: 'settings', label: uiText('Definições'), icon: 'settings' },
  ]}/>
}
export function ChangesTabs({ active, workingCount, pendingCount, onChange }: {
  active: GitChangesTab; workingCount: number; pendingCount: number; onChange: (tab: GitChangesTab) => void
}) {
  return <WorkbenchTabs label={uiText('Tipos de alterações locais')} value={active} onChange={onChange} items={[
    { id: 'working', label: uiText('Alterações pendentes'), icon: 'edit', badge: workingCount },
    { id: 'pending', label: uiText('Commits pendentes'), icon: 'clipboard', badge: pendingCount },
  ]}/>
}
