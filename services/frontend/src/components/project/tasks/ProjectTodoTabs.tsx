import { WorkbenchTabs } from '../../presentation/tabs'
export type ProjectTodoFilter = 'open' | 'pending' | 'executed' | 'failed' | 'completed'
export function ProjectTodoTabs({ value, onChange, counts }: { value: ProjectTodoFilter; onChange: (value: ProjectTodoFilter) => void; counts: Record<ProjectTodoFilter, number> }) {
  return <WorkbenchTabs label="Estado dos TODOs" value={value} onChange={onChange} items={[
    { id: 'open', label: 'Abertos', icon: 'list', badge: counts.open }, { id: 'pending', label: 'Fazendo', icon: 'play', badge: counts.pending },
    { id: 'executed', label: 'Feito', icon: 'check', badge: counts.executed }, { id: 'failed', label: 'Falha', icon: 'alert', badge: counts.failed },
    { id: 'completed', label: 'Concluídos', icon: 'archive', badge: counts.completed },
  ]}/>
}
