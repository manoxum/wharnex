import type { IconName } from '../../presentation/chrome/Icon'
import type { WorkspaceTool } from '../../../lib/workspace/layout/workspaceRailLayout'
import type { Drawer } from '../../../lib/workspace/layout/workspaceDrawer'

export type WorkspaceToolMeta = {
  label: string
  title: string
  icon: IconName
  drawer?: Exclude<Drawer, ''>
  badge?: number
}

type MetaContext = { terminalOpen: boolean; pendingCommitCount: number; savedChatCount: number }

export function workspaceToolMeta(tool: WorkspaceTool, context: MetaContext): WorkspaceToolMeta {
  if (tool === 'todo') return { label: 'TODO do projeto', title: 'Ideias, necessidades, erros e melhorias', icon: 'check', drawer: 'todo' }
  if (tool === 'archive') return { label: 'Gestão de chats', title: 'Chats guardados e arquivados', icon: 'archive', drawer: 'archive', badge: context.savedChatCount }
  if (tool === 'project') return { label: 'Explorador do projeto', title: 'Explorador do projeto', icon: 'workspace', drawer: 'project' }
  if (tool === 'library') return { label: 'Biblioteca de ficheiros', title: 'Biblioteca de ficheiros', icon: 'package', drawer: 'library' }
  if (tool === 'knowledge') return { label: 'Conhecimento do projeto', title: 'Conhecimento adquirido', icon: 'knowledge', drawer: 'knowledge' }
  if (tool === 'git') return { label: 'Git do projeto', title: 'Git do projeto', icon: 'git', drawer: 'git', badge: context.pendingCommitCount }
  if (tool === 'agents') return { label: 'Gestão de agentes', title: 'Supervisor e Workers', icon: 'agent', drawer: 'agents' }
  if (tool === 'external-agents') return { label: 'Hub de agentes IA', title: 'Codex, Claude Code e Cline', icon: 'sparkles', drawer: 'external-agents' }
  if (tool === 'tasks') return { label: 'Tarefas do projeto', title: 'Chats, workers, traduções, orquestração e execuções', icon: 'list', drawer: 'tasks' }
  if (tool === 'errors') return { label: 'Erros de execução', title: 'Ocorrências, causas, logs e soluções', icon: 'alert', drawer: 'errors' }
  if (tool === 'evolution') return { label: 'Logs de auto-evolução', title: 'Logs e análise de auto-evolução', icon: 'refresh', drawer: 'evolution' }
  if (tool === 'database') return { label: 'Database connection', title: 'Database connection', icon: 'database', drawer: 'database' }
  if (tool === 'docker') return { label: 'Docker', title: 'Containers, imagens, volumes e redes', icon: 'container', drawer: 'docker' }
  if (tool === 'ui-testing') return { label: 'UI Lab', title: 'Debug, testes e user guide', icon: 'flask', drawer: 'ui-testing' }
  return { label: context.terminalOpen ? 'Fechar terminal' : 'Abrir terminal', title: context.terminalOpen ? 'Fechar terminal' : 'Abrir terminal do projeto', icon: 'terminal' }
}

export function isWorkspaceTool(value: string): value is WorkspaceTool {
  return ['archive', 'todo', 'project', 'library', 'knowledge', 'git', 'agents', 'external-agents', 'tasks', 'errors', 'evolution', 'terminal', 'database', 'docker', 'ui-testing'].includes(value)
}
