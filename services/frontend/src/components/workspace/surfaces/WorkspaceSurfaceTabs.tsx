import type { MouseEvent } from 'react'
import { workspaceSurfaceKey, workspaceDragEndedOutside, type WorkspaceSurfaceTarget, type WorkspaceSurfaceTransferPoint } from '../../../lib/workspace'
import { TabBar, TabButton } from '../../presentation/tabs'
export function WorkspaceSurfaceTabs({ targets, activeKey, label, onSelect, onContextMenu, onMove }: {
  targets: WorkspaceSurfaceTarget[]; activeKey: string; label: (target: WorkspaceSurfaceTarget) => string
  onSelect: (target: WorkspaceSurfaceTarget) => void; onContextMenu: (event: MouseEvent<HTMLButtonElement>, target: WorkspaceSurfaceTarget) => void
  onMove: (target: WorkspaceSurfaceTarget, point: WorkspaceSurfaceTransferPoint) => void
}) {
  return <TabBar label="Tabs da janela destacada" className="min-w-0 flex-1 [-webkit-app-region:no-drag]">
    {targets.map((target) => <TabButton key={workspaceSurfaceKey(target)} selected={workspaceSurfaceKey(target) === activeKey}
      label={label(target)} icon={target.kind === 'chat' ? 'send' : target.kind === 'editor' ? 'code' : 'terminal'}
      title={target.kind === 'editor' ? target.path : label(target)} draggable onClick={() => onSelect(target)}
      onContextMenu={(event) => onContextMenu(event, target)} onDragEnd={(event) => { if (workspaceDragEndedOutside(event)) onMove(target, { screenX: event.screenX, screenY: event.screenY }) }}/>) }
  </TabBar>
}
