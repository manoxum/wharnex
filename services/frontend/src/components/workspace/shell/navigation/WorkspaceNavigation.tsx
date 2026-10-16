import { navigateTools } from './toolNavigation'
import type { DragEvent } from 'react'
import type { WorkspaceRailSide, WorkspaceTool } from '../../../../lib/workspace/layout/workspaceRailLayout'
import type { Drawer } from '../../../../lib/workspace/layout/workspaceDrawer'
import { Icon } from '../../../presentation/chrome/Icon'
import { workspaceToolMeta, isWorkspaceTool } from '../workspaceToolPresentation'

const TOOL_DRAG_TYPE = 'application/x-wharnex-workspace-tool'
type Group = 'development' | 'intelligence' | 'tools'
const GROUPS: Record<Group, string> = { development: 'Desenvolvimento', intelligence: 'Inteligência artificial', tools: 'Ferramentas e recursos' }
function toolGroup(tool: WorkspaceTool): Group {
  if (['project', 'git', 'errors'].includes(tool)) return 'development'
  if (['agents', 'external-agents', 'archive', 'tasks', 'evolution'].includes(tool)) return 'intelligence'
  return 'tools'
}

export function WorkspaceNavigation({ side, tools, pinnedTools, drawer, terminalOpen, pendingCommitCount, savedChatCount, onToggle, onToggleTerminal, onMoveTool }: {
  side: WorkspaceRailSide; tools: WorkspaceTool[]; pinnedTools: WorkspaceTool[]; drawer: Drawer
  terminalOpen: boolean; pendingCommitCount: number; savedChatCount: number
  onToggle: (drawer: Exclude<Drawer, ''>) => void; onToggleTerminal: () => void
  onMoveTool?: (tool: WorkspaceTool, side: WorkspaceRailSide, before?: WorkspaceTool, pinned?: boolean) => void
}) {
  function drop(event: DragEvent, before?: WorkspaceTool, pinned = false) {
    if (!onMoveTool) return
    event.preventDefault(); event.stopPropagation()
    const tool = event.dataTransfer.getData(TOOL_DRAG_TYPE) || event.dataTransfer.getData('text/plain')
    if (isWorkspaceTool(tool)) onMoveTool(tool, side, before, pinned)
  }
  const allowDrop = (event: DragEvent) => { if (onMoveTool) event.preventDefault() }
  const renderTool = (tool: WorkspaceTool, pinned: boolean) => {
    const meta = workspaceToolMeta(tool, { terminalOpen, pendingCommitCount, savedChatCount })
    const active = tool === 'terminal' ? terminalOpen : drawer === meta.drawer
    return <button key={tool} type="button" draggable={Boolean(onMoveTool)} data-workspace-tool={tool} data-pinned={String(pinned)}
      className={`relative !mx-auto !grid !size-9 !min-h-9 !shrink-0 !place-items-center !rounded-md !border-0 !p-0 !shadow-none transition-colors motion-reduce:transition-none focus-visible:!outline-none focus-visible:!ring-2 focus-visible:!ring-whx-accent ${active ? 'active !bg-transparent !text-whx-text before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:rounded-full before:bg-whx-accent' : '!bg-transparent !text-whx-faint hover:!bg-whx-hover hover:!text-whx-text'} ${tool === 'terminal' ? 'workspace-rail-terminal' : ''}`}
      onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData(TOOL_DRAG_TYPE, tool); event.dataTransfer.setData('text/plain', tool) }}
      onDragOver={allowDrop} onDrop={(event) => drop(event, tool, pinned)}
      onClick={() => tool === 'terminal' ? onToggleTerminal() : meta.drawer && onToggle(meta.drawer)}
      aria-pressed={active} aria-label={meta.label}
      aria-description={GROUPS[toolGroup(tool)]} title={`${meta.title}${onMoveTool ? ' · arraste para reorganizar' : ''}`}>
      <Icon name={meta.icon} size={19}/>
      {Boolean(meta.badge) && <b className="!absolute !-right-0.5 !top-0 !grid !min-w-3.5 !place-items-center !rounded-full !bg-whx-accent !px-0.5 !text-[10px] !leading-[14px] !text-[color:var(--theme-bg)]" aria-hidden="true">{meta.badge! > 99 ? '99+' : meta.badge}</b>}
    </button>
  }
  const groups: Array<{ group: Group; tools: WorkspaceTool[] }> = []
  for (const tool of tools) {
    const group = toolGroup(tool)
    if (groups.at(-1)?.group === group) groups.at(-1)!.tools.push(tool)
    else groups.push({ group, tools: [tool] })
  }
  return <aside className={`agent-activity-bar workspace-side-rail workspace-side-rail-${side}`} aria-label={side === 'left' ? 'Ferramentas do workspace' : 'Ferramentas laterais direitas'} onKeyDown={navigateTools} onDragOver={allowDrop} onDrop={(event) => drop(event)}>
    <nav className="workspace-rail-primary !min-h-0 !gap-0 !overflow-y-auto !overflow-x-hidden [scrollbar-width:thin] [[data-tool-rail=bottom]_&]:!flex-row [[data-tool-rail=bottom]_&]:!overflow-x-auto" aria-label={side === 'left' ? 'Navegação do projeto' : 'Ferramentas auxiliares'}>
      {groups.map((group, index) => <div key={`${group.group}-${index}`} role="group" aria-label={GROUPS[group.group]} className={`flex shrink-0 flex-col gap-1 py-2 [[data-tool-rail=bottom]_&]:flex-row [[data-tool-rail=bottom]_&]:px-1 [[data-tool-rail=bottom]_&]:py-0 ${index ? 'mt-1 [[data-tool-rail=bottom]_&]:ml-1 [[data-tool-rail=bottom]_&]:mt-0' : ''}`}>{group.tools.map((tool) => renderTool(tool, false))}</div>)}
    </nav>
    {side === 'right' && <div className="workspace-agent-rail-slot" aria-label="Atalhos do Agent integrados"/>}
    <div className={`workspace-rail-pinned ${pinnedTools.length ? 'has-tools' : ''}`} aria-label="Ferramentas fixadas no canto inferior" title="Arraste um ícone para aqui para o fixar no canto inferior" onDragOver={allowDrop} onDrop={(event) => drop(event, undefined, true)}>
      {pinnedTools.map((tool) => renderTool(tool, true))}
      {onMoveTool && <span className="workspace-rail-pin-target" aria-hidden="true"/>}
    </div>
  </aside>
}
