export type Drawer = 'attention' | 'archive' | 'todo' | 'project' | 'library' | 'knowledge' | 'git' | 'agents' | 'external-agents' | 'tasks' | 'evolution' | 'database' | 'docker' | 'ui-testing' | 'errors' | ''

export const WORKSPACE_DRAWERS: Exclude<Drawer, ''>[] = ['attention', 'archive', 'todo', 'project', 'library', 'knowledge', 'git', 'agents', 'external-agents', 'tasks', 'errors', 'evolution', 'database', 'docker', 'ui-testing']

export function workspaceDrawerLabel(drawer: Exclude<Drawer, ''>) {
  if (drawer === 'attention') return 'Centro de Alertas'
  if (drawer === 'archive') return 'Gestão de chats'
  if (drawer === 'todo') return 'TODO do projeto'
  if (drawer === 'project') return 'Explorador do projeto'
  if (drawer === 'library') return 'Biblioteca de ficheiros'
  if (drawer === 'knowledge') return 'Conhecimento do projeto'
  if (drawer === 'git') return 'Git do projeto'
  if (drawer === 'agents') return 'Gestão de agentes'
  if (drawer === 'external-agents') return 'Codex'
  if (drawer === 'tasks') return 'Tarefas do projeto'
  if (drawer === 'errors') return 'Erros de execução'
  if (drawer === 'evolution') return 'Logs de auto-evolução'
  if (drawer === 'database') return 'Database Studio'
  if (drawer === 'ui-testing') return 'UI Lab'
  return 'Docker'
}
