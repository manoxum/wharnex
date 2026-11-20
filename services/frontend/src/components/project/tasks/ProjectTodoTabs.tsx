import { translate as uiText } from '../../../lib/workspace/localization'
import { WorkbenchTabs } from '../../presentation/tabs'
export type ProjectTodoFilter = 'open' | 'pending' | 'executed' | 'failed' | 'completed'
export function ProjectTodoTabs({ value, onChange, counts }: { value: ProjectTodoFilter; onChange: (value: ProjectTodoFilter) => void; counts: Record<ProjectTodoFilter, number> }) {
  return <WorkbenchTabs label={uiText("Estado dos TODOs")} value={value} onChange={onChange} items={[
    { id: 'open', label: uiText("Abertos"), icon: 'list', badge: counts.open }, { id: 'pending', label: uiText("Fazendo"), icon: 'play', badge: counts.pending },
    { id: 'executed', label: uiText("Feito"), icon: 'check', badge: counts.executed }, { id: 'failed', label: uiText("Falha"), icon: 'alert', badge: counts.failed },
    { id: 'completed', label: uiText("Concluídos"), icon: 'archive', badge: counts.completed },
  ]}/>
}
