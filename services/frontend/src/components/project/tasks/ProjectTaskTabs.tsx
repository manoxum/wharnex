import { translate as uiText } from '../../../lib/workspace/localization'
import { WorkbenchTabs } from '../../presentation/tabs'
type TaskTab = 'queue' | 'completed' | 'archived'
export function ProjectTaskTabs({ value, onChange, counts }: { value: TaskTab; onChange: (value: TaskTab) => void; counts: Record<TaskTab, number> }) {
  return <WorkbenchTabs label={uiText("Estados das tarefas")} value={value} onChange={onChange} items={[
    { id: 'queue', label: uiText("Em curso"), icon: 'list', badge: counts.queue, controls: 'project-task-panel' },
    { id: 'completed', label: uiText("Concluídas"), icon: 'check', badge: counts.completed, controls: 'project-task-panel' },
    { id: 'archived', label: uiText("Arquivadas"), icon: 'archive', badge: counts.archived, controls: 'project-task-panel' },
  ]}/>
}
