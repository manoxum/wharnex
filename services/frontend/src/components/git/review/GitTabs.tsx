import { WorkbenchTabs } from '../../presentation/tabs'
import type { GitOverview } from '../../../types'
export type GitTab = 'changes' | 'history' | 'contributors' | 'branches' | 'settings'
export type GitChangesTab = 'working' | 'pending'
export function GitTabs({ active, onChange, overview }: { active: GitTab; onChange: (tab: GitTab) => void; overview: GitOverview }) {
  const current = overview.branches.find((branch) => !branch.remote && branch.current)
  const unpublished = current?.has_upstream && !current.gone ? current.ahead : overview.commits.filter((commit) => !commit.pushed).length
  const changes = (overview.working.files?.length || overview.working.stageable_count) + unpublished
  return <WorkbenchTabs label="Secções do Git" value={active} onChange={onChange} items={[
    { id: 'changes', label: 'Alterações', icon: 'edit', badge: changes },
    { id: 'history', label: 'Histórico', icon: 'git', badge: overview.commits.length },
    { id: 'contributors', label: 'Contribuidores', icon: 'agent' },
    { id: 'branches', label: 'Branches', icon: 'bridge', badge: overview.branches.length },
    { id: 'settings', label: 'Definições', icon: 'settings' },
  ]}/>
}
export function ChangesTabs({ active, workingCount, pendingCount, onChange }: {
  active: GitChangesTab; workingCount: number; pendingCount: number; onChange: (tab: GitChangesTab) => void
}) {
  return <WorkbenchTabs label="Tipos de alterações locais" value={active} onChange={onChange} items={[
    { id: 'working', label: 'Alterações pendentes', icon: 'edit', badge: workingCount },
    { id: 'pending', label: 'Commits pendentes', icon: 'clipboard', badge: pendingCount },
  ]}/>
}
