import { translate as uiText } from '../../../../lib/workspace/localization'
import { IconButton, PanelHeader } from '../../../presentation/workbench'
export function AgentRuntimeHeader({ onRefresh, onClose }: { onRefresh?: () => void; onClose: () => void }) {
  return <PanelHeader title={uiText("Agentes")} icon="agent" actions={<>{onRefresh && <IconButton label={uiText("Atualizar agentes")} icon="refresh" onClick={onRefresh}/>}<IconButton label={uiText("Fechar agentes")} icon="close" onClick={onClose}/></>}/>
}
