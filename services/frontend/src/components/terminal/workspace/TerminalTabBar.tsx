import { workspaceDragEndedOutside } from '../../../lib/workspace/layout/workspaceSurface'
import { Icon } from '../../presentation/chrome/Icon'
import { TabBar, TabButton } from '../../presentation/tabs'
import type { ConnectionStatus } from './InteractiveTerminal'
import type { PersistedTerminalTab } from './terminalWorkspaceState'
import { statusLabel } from './terminalWorkspaceHelpers'
export function TerminalTabBar<Tab extends PersistedTerminalTab & { status: ConnectionStatus }>({ tabs, activeID, editingID, editingLabel, onSelect, onBeginRename, onEditingLabel, onFinishRename, onCancelRename, onClose, onDetach }: {
  tabs: Tab[]; activeID: number; editingID?: number; editingLabel: string; onSelect: (id: number) => void
  onBeginRename: (tab: Tab) => void; onEditingLabel: (label: string) => void; onFinishRename: (id: number) => void
  onCancelRename: () => void; onClose: (id: number) => void; onDetach?: () => void
}) {
  return <TabBar appearance="terminal" label="Instâncias do terminal" className="min-w-0 flex-1">{tabs.map((tab) => <div data-resource-tab data-selected={tab.id === activeID} className="group/terminal min-w-0 max-w-[240px] h-[34px] [:root[data-density=compact]_&]:h-[24px] shrink-0 flex items-center border-0 border-r border-solid border-[var(--theme-border-soft)] bg-transparent text-whx-faint hover:bg-[color-mix(in_srgb,var(--theme-hover)_62%,transparent)] hover:text-whx-soft data-[selected=true]:border-transparent data-[selected=true]:text-whx-text data-[selected=true]:shadow-[inset_0_-2px_0_var(--theme-accent)]" key={tab.id} draggable={Boolean(onDetach)} onDragEnd={(event) => { if (onDetach && workspaceDragEndedOutside(event)) onDetach() }}>
    {editingID === tab.id ? <div className="terminal-tab-edit"><input autoFocus aria-label={`Renomear ${tab.label}`} value={editingLabel} onChange={(event) => onEditingLabel(event.target.value)} onBlur={() => onFinishRename(tab.id)} onKeyDown={(event) => {
      if (event.key === 'Enter') { event.preventDefault(); onFinishRename(tab.id) }
      if (event.key === 'Escape') { event.preventDefault(); onCancelRename() }
    }}/></div> : <TabButton label={tab.label} appearance="terminal" icon={<span className={`terminal-status-${tab.status} size-[6px] shrink-0 rounded-full bg-current opacity-85`} aria-hidden="true"/>} selected={tab.id === activeID} onClick={() => onSelect(tab.id)} onDoubleClick={() => onBeginRename(tab)} title={`${tab.label} · ${statusLabel(tab.status)} · duplo clique para renomear`}/>}
    <button type="button" className="mr-px grid size-[var(--toolbar-hit)] flex-[0_0_19px] place-items-center rounded-[4px] border border-solid border-transparent bg-transparent px-1.5 py-px text-whx-faint opacity-0 transition-[background-color,color,opacity] duration-[var(--motion-fast)] group-data-[selected=true]/terminal:opacity-72 group-hover/terminal:opacity-100 focus-visible:opacity-100 hover:border-[var(--theme-border-soft)] hover:bg-whx-hover hover:text-whx-text [&>svg]:size-[var(--icon-xs)]" title={`Fechar ${tab.label}`} aria-label={`Fechar ${tab.label}`} onClick={() => onClose(tab.id)}><Icon name="close" size={14}/></button>
  </div>)}</TabBar>
}
