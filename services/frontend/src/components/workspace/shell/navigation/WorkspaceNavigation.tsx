import { translate as uiText } from '../../../../lib/workspace/localization'
import { selectUtility, useUtilityState } from '../operations/utilityNavigation'
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
  if (['project', 'git', 'problems', 'output', 'errors'].includes(tool)) return 'development'
  if (['agents', 'external-agents', 'archive', 'tasks', 'evolution'].includes(tool)) return 'intelligence'
  return 'tools'
}

export function WorkspaceNavigation({ side, tools, pinnedTools, drawer, terminalOpen, pendingCommitCount, savedChatCount, onToggle, onToggleTerminal, onMoveTool }: {
  side: WorkspaceRailSide; tools: WorkspaceTool[]; pinnedTools: WorkspaceTool[]; drawer: Drawer
  terminalOpen: boolean; pendingCommitCount: number; savedChatCount: number
  onToggle: (drawer: Exclude<Drawer, ''>) => void; onToggleTerminal: () => void
  onMoveTool?: (tool: WorkspaceTool, side: WorkspaceRailSide, before?: WorkspaceTool, pinned?: boolean) => void
}) {
  const utility = useUtilityState()
  function drop(event: DragEvent, before?: WorkspaceTool, pinned = false) {
    if (!onMoveTool) return
    event.preventDefault(); event.stopPropagation()
    const tool = event.dataTransfer.getData(TOOL_DRAG_TYPE) || event.dataTransfer.getData('text/plain')
    if (isWorkspaceTool(tool)) onMoveTool(tool, side, before, pinned)
  }
  const allowDrop = (event: DragEvent) => { if (onMoveTool) event.preventDefault() }
  const renderTool = (tool: WorkspaceTool, pinned: boolean) => {
    const terminalActive = terminalOpen && utility.tool === 'terminal'
    const meta = workspaceToolMeta(tool, { terminalOpen: terminalActive, pendingCommitCount, savedChatCount })
    const operational = tool === 'terminal' || tool === 'problems' || tool === 'output'
    const active = operational ? (tool === 'terminal' ? terminalActive : utility.visible && utility.tool === tool) : drawer === meta.drawer
    if (tool === 'problems') meta.badge = utility.problems
    return <button key={tool} type="button" draggable={Boolean(onMoveTool)} data-workspace-tool={tool} data-pinned={String(pinned)}
      className={`relative !mx-auto !grid !size-9 !min-h-9 [[data-density=compact]_&]:!size-8 [[data-density=compact]_&]:!min-h-8 !shrink-0 !place-items-center !rounded-md !border-0 !p-0 !shadow-none transition-colors motion-reduce:transition-none focus-visible:!outline-none focus-visible:!ring-2 focus-visible:!ring-whx-accent ${active ? 'active !bg-whx-tool-selected !text-whx-text before:absolute before:-left-1 before:top-2 before:h-5 before:w-0.5 before:rounded-full before:bg-whx-accent [[data-tool-rail=bottom]_&]:before:inset-x-2 [[data-tool-rail=bottom]_&]:before:top-auto [[data-tool-rail=bottom]_&]:before:bottom-0 [[data-tool-rail=bottom]_&]:before:h-0.5 [[data-tool-rail=bottom]_&]:before:w-auto' : '!bg-transparent !text-whx-faint hover:!bg-whx-hover hover:!text-whx-text'} ${tool === 'terminal' ? 'workspace-rail-terminal' : ''}`}
      onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData(TOOL_DRAG_TYPE, tool); event.dataTransfer.setData('text/plain', tool) }}
      onDragOver={allowDrop} onDrop={(event) => drop(event, tool, pinned)}
      onClick={() => operational ? (tool === 'terminal' && terminalActive ? onToggleTerminal() : selectUtility(tool)) : meta.drawer && onToggle(meta.drawer)}
      aria-pressed={active} aria-label={meta.label}
      aria-description={uiText(GROUPS[toolGroup(tool)])} title={`${meta.title}${onMoveTool ? ` · ${uiText('arraste para reorganizar')}` : ''}`}>
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
  return <aside className={`agent-activity-bar workspace-side-rail workspace-side-rail-${side} relative z-20 flex min-h-0 w-12 basis-12 shrink-0 flex-col items-center gap-1 border-0 bg-whx-rail px-1 py-1 [[data-tool-rail=bottom]_&]:absolute [[data-tool-rail=bottom]_&]:bottom-1 [[data-tool-rail=bottom]_&]:z-[90] [[data-tool-rail=bottom]_&]:h-10 [[data-tool-rail=bottom]_&]:w-auto [[data-tool-rail=bottom]_&]:max-w-[calc(100%-16px)] [[data-tool-rail=bottom]_&]:flex-row [[data-tool-rail=bottom]_&]:rounded-md [[data-tool-rail=bottom]_&]:border [[data-tool-rail=bottom]_&]:border-whx-border ${side === 'left' ? '[[data-tool-rail=bottom]_&]:left-2' : '[[data-tool-rail=bottom]_&]:right-2'}`} aria-label={side === 'left' ? uiText("Ferramentas do workspace") : uiText("Ferramentas laterais direitas")} onKeyDown={navigateTools} onDragOver={allowDrop} onDrop={(event) => drop(event)}>
    <nav className="workspace-rail-primary flex w-full flex-1 flex-col items-center !min-h-0 !gap-0 !overflow-y-auto !overflow-x-hidden [scrollbar-width:thin] [[data-tool-rail=bottom]_&]:!w-auto [[data-tool-rail=bottom]_&]:!flex-row [[data-tool-rail=bottom]_&]:!overflow-x-auto" aria-label={side === 'left' ? uiText("Navegação do projeto") : uiText("Ferramentas auxiliares")}>
      {groups.map((group, index) => <div key={`${group.group}-${index}`} role="group" aria-label={uiText(GROUPS[group.group])} className={`flex shrink-0 flex-col gap-1.5 py-1 [[data-tool-rail=bottom]_&]:flex-row [[data-tool-rail=bottom]_&]:px-1 [[data-tool-rail=bottom]_&]:py-0 ${index ? 'mt-2 [[data-tool-rail=bottom]_&]:ml-2 [[data-tool-rail=bottom]_&]:mt-0' : ''}`}>{group.tools.map((tool) => renderTool(tool, false))}</div>)}
    </nav>
    {side === 'right' && <div className="workspace-agent-rail-slot" aria-label={uiText("Atalhos do Agent integrados")}/>}
    <div className={`workspace-rail-pinned mt-auto flex w-full shrink-0 flex-col items-center gap-1.5 border-t border-whx-border-soft pt-2 [[data-tool-rail=bottom]_&]:ml-2 [[data-tool-rail=bottom]_&]:mt-0 [[data-tool-rail=bottom]_&]:w-auto [[data-tool-rail=bottom]_&]:flex-row [[data-tool-rail=bottom]_&]:border-l [[data-tool-rail=bottom]_&]:border-t-0 [[data-tool-rail=bottom]_&]:pl-2 [[data-tool-rail=bottom]_&]:pt-0 ${pinnedTools.length ? 'has-tools' : ''}`} aria-label={uiText("Ferramentas fixadas no canto inferior")} title={uiText("Arraste um ícone para aqui para o fixar no canto inferior")} onDragOver={allowDrop} onDrop={(event) => drop(event, undefined, true)}>
      {pinnedTools.map((tool) => renderTool(tool, true))}
      {onMoveTool && <span className="workspace-rail-pin-target h-0.5 w-5 rounded-full bg-whx-border" aria-hidden="true"/>}
    </div>
  </aside>
}
