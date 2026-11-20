import { translate as uiText } from '../../../lib/workspace/localization'
import { IconButton } from '../../presentation/workbench'
import { WorkbenchTabs } from '../../presentation/tabs'

type Section = 'overview' | 'tasks'
export function OrchestratorHeader({ section, count, busy, onSection, onRefresh }: {
  section: Section; count: number; busy: boolean; onSection: (section: Section) => void; onRefresh: () => void
}) {
  return <header className="flex min-w-0 items-center gap-3 border-b border-whx-border-soft bg-whx-surface px-3">
    <strong className="hidden shrink-0 text-whx-label font-semibold text-whx-soft @min-[520px]/orchestration:block">Orchestrator</strong>
    <WorkbenchTabs label="Orchestrator" value={section} onChange={onSection} className="!min-h-10 !min-w-0 !max-w-[320px] !flex-1 !border-0 !bg-transparent" items={[
      { id: 'overview', label: 'Overview', icon: 'plan' },
      { id: 'tasks', label: 'Tasks', icon: 'list', badge: count },
    ]}/>
    <IconButton className="!ml-auto" label={uiText("Atualizar Orchestrator")} icon="refresh" disabled={busy} onClick={onRefresh}/>
  </header>
}
