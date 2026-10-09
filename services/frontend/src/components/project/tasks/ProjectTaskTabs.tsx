import { WorkbenchTabs } from '../../presentation/tabs'
type TaskTab = 'queue' | 'completed' | 'archived'
export function ProjectTaskTabs({ value, onChange, counts }: { value: TaskTab; onChange: (value: TaskTab) => void; counts: Record<TaskTab, number> }) {
  return <WorkbenchTabs label="Estados das tarefas" value={value} onChange={onChange} items={[
    { id: 'queue', label: 'Em curso', icon: 'list', badge: counts.queue, controls: 'project-task-panel' },
    { id: 'completed', label: 'Concluídas', icon: 'check', badge: counts.completed, controls: 'project-task-panel' },
    { id: 'archived', label: 'Arquivadas', icon: 'archive', badge: counts.archived, controls: 'project-task-panel' },
  ]}/>
}
