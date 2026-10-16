import { IconButton, PanelHeader } from '../../../presentation/workbench'
export function AgentRuntimeHeader({ onRefresh, onClose }: { onRefresh?: () => void; onClose: () => void }) {
  return <PanelHeader title="Agentes" description="Supervisor, Workers e políticas do runtime." icon="agent" actions={<>{onRefresh && <IconButton label="Atualizar agentes" icon="refresh" onClick={onRefresh}/>}<IconButton label="Fechar agentes" icon="close" onClick={onClose}/></>}/>
}
