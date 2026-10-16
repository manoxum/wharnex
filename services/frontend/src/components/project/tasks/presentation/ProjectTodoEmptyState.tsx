import { Button, EmptyState } from '../../../presentation/workbench'
import type { ProjectTodoFilter } from '../ProjectTodoTabs'

const EMPTY_STATE: Record<ProjectTodoFilter, { title: string; description: string; icon: 'list' | 'play' | 'check' | 'alert' | 'archive' }> = {
  open: {
    title: 'Ainda não registaste uma ideia',
    description: 'Guarda uma tarefa, erro ou melhoria aqui. Depois podes encaminhá-la para um chat ou para o Orchestrator.',
    icon: 'list',
  },
  pending: {
    title: 'Nada em execução',
    description: 'Os TODOs encaminhados ficam aqui enquanto o pedido ou plano está a ser processado.',
    icon: 'play',
  },
  executed: {
    title: 'Sem execuções concluídas',
    description: 'As execuções terminadas com sucesso aparecem aqui.',
    icon: 'check',
  },
  failed: {
    title: 'Sem falhas',
    description: 'Os TODOs cuja execução falhou aparecem aqui com a ligação ao chat de origem.',
    icon: 'alert',
  },
  completed: {
    title: 'Ainda não há TODOs concluídos',
    description: 'Os itens que concluis manualmente ficam guardados aqui.',
    icon: 'archive',
  },
}

export function ProjectTodoEmptyState({ filter, onAdd }: { filter: ProjectTodoFilter; onAdd: () => void }) {
  const state = EMPTY_STATE[filter]
  const action = filter === 'open'
    ? <Button tone="primary" icon="plus" onClick={onAdd}>Registar uma ideia</Button>
    : undefined

  return <EmptyState title={state.title} description={state.description} icon={state.icon} action={action} compact/>
}
