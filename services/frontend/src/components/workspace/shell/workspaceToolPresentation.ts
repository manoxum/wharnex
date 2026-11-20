import { translate as uiText } from '../../../lib/workspace/localization'
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
  if (tool === 'problems') return { label: uiText("Problemas"), title: uiText("Diagnósticos de código"), icon: 'alert' }
  if (tool === 'output') return { label: uiText("Saída de execução"), title: uiText("Comandos, stdout, stderr e eventos"), icon: 'list' }
  if (tool === 'todo') return { label: uiText("TODO do projeto"), title: uiText("Ideias, necessidades, erros e melhorias"), icon: 'check', drawer: 'todo' }
  if (tool === 'archive') return { label: uiText("Gestão de chats"), title: uiText("Chats guardados e arquivados"), icon: 'archive', drawer: 'archive', badge: context.savedChatCount }
  if (tool === 'project') return { label: uiText("Explorador do projeto"), title: uiText("Explorador do projeto"), icon: 'workspace', drawer: 'project' }
  if (tool === 'library') return { label: uiText("Biblioteca de ficheiros"), title: uiText("Biblioteca de ficheiros"), icon: 'package', drawer: 'library' }
  if (tool === 'knowledge') return { label: uiText("Conhecimento do projeto"), title: uiText("Conhecimento adquirido"), icon: 'knowledge', drawer: 'knowledge' }
  if (tool === 'git') return { label: uiText("Git do projeto"), title: uiText("Git do projeto"), icon: 'git', drawer: 'git', badge: context.pendingCommitCount }
  if (tool === 'agents') return { label: uiText("Gestão de agentes"), title: uiText("Supervisor e Workers"), icon: 'agent', drawer: 'agents' }
  if (tool === 'external-agents') return { label: 'Codex', title: uiText("Codex · conta, consumo e conversas"), icon: 'code', drawer: 'external-agents' }
  if (tool === 'tasks') return { label: uiText("Tarefas do projeto"), title: uiText("Chats, workers, traduções, orquestração e execuções"), icon: 'list', drawer: 'tasks' }
  if (tool === 'errors') return { label: uiText("Erros de execução"), title: uiText("Ocorrências, causas, logs e soluções"), icon: 'alert', drawer: 'errors' }
  if (tool === 'evolution') return { label: uiText("Logs de auto-evolução"), title: uiText("Logs e análise de auto-evolução"), icon: 'refresh', drawer: 'evolution' }
  if (tool === 'database') return { label: 'Database connection', title: 'Database connection', icon: 'database', drawer: 'database' }
  if (tool === 'docker') return { label: 'Docker', title: uiText("Containers, imagens, volumes e redes"), icon: 'container', drawer: 'docker' }
  if (tool === 'ui-testing') return { label: 'UI Lab', title: uiText("Debug, testes e user guide"), icon: 'flask', drawer: 'ui-testing' }
  return { label: context.terminalOpen ? uiText("Fechar terminal") : uiText("Abrir terminal"), title: context.terminalOpen ? uiText("Fechar terminal") : uiText("Abrir terminal do projeto"), icon: 'terminal' }
}

export function isWorkspaceTool(value: string): value is WorkspaceTool {
  return ['archive', 'todo', 'project', 'library', 'knowledge', 'git', 'agents', 'external-agents', 'tasks', 'errors', 'evolution', 'problems', 'output', 'terminal', 'database', 'docker', 'ui-testing'].includes(value)
}
