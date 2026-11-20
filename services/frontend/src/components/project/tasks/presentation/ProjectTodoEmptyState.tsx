import { translate as uiText } from '../../../../lib/workspace/localization'
import { Button, EmptyState } from '../../../presentation/workbench'
import type { ProjectTodoFilter } from '../ProjectTodoTabs'

const EMPTY_STATE: Record<ProjectTodoFilter, { title: string; icon: 'list' | 'play' | 'check' | 'alert' | 'archive' }> = {
  open: {
    title: 'Sem tarefas',
    icon: 'list',
  },
  pending: {
    title: 'Sem tarefas em execução',
    icon: 'play',
  },
  executed: {
    title: 'Sem execuções concluídas',
    icon: 'check',
  },
  failed: {
    title: 'Sem falhas',
    icon: 'alert',
  },
  completed: {
    title: 'Sem tarefas concluídas',
    icon: 'archive',
  },
}

export function ProjectTodoEmptyState({ filter, onAdd }: { filter: ProjectTodoFilter; onAdd: () => void }) {
  const state = EMPTY_STATE[filter]
  const action = filter === 'open'
    ? <Button tone="primary" icon="plus" onClick={onAdd}>{uiText("Adicionar tarefa")}</Button>
    : undefined

  return <EmptyState title={uiText(state.title)} icon={state.icon} action={action} compact/>
}
