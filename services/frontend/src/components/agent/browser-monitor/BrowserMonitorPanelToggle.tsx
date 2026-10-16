import { IconButton } from '../../presentation/workbench'

type Panel = 'lista de instâncias' | 'painel de detalhes'
export function BrowserMonitorPanelToggle({ panel, expanded, onToggle }: { panel: Panel; expanded: boolean; onToggle: () => void }) {
  return <IconButton label={`${expanded ? 'Recolher' : 'Expandir'} ${panel}`} icon="list" aria-expanded={expanded} onClick={onToggle}/>
}
