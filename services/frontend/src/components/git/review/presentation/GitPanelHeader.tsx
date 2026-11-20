import { IconButton, PanelHeader } from '../../../presentation/workbench'
import { translate as uiText } from '../../../../lib/workspace/localization'
export function GitPanelHeader({ branch, disabled, onRefresh, onClose }: { branch?: string; disabled: boolean; onRefresh: () => void; onClose: () => void }) {
  return <PanelHeader title="Git" description={branch} icon="git" actions={<><IconButton label={uiText('Atualizar estado do Git')} icon="refresh" disabled={disabled} onClick={onRefresh}/><IconButton label={uiText('Fechar Git')} icon="close" onClick={onClose}/></>}/>
}
