import { translate as uiText } from '../../../../lib/workspace/localization'
import { IconButton, PanelHeader } from '../../../presentation/workbench'
export function DockerPanelHeader({ loading, onRefresh, onClose }: { loading: boolean; onRefresh: () => void; onClose?: () => void }) {
  return <PanelHeader title="Docker" icon="container" actions={<><IconButton label={uiText("Atualizar Docker")} icon="refresh" disabled={loading} onClick={onRefresh}/>{onClose && <IconButton label={uiText("Fechar Docker")} icon="close" onClick={onClose}/>}</>}/>
}
