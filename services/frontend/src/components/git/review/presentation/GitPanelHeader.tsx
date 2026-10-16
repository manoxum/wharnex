import { IconButton, PanelHeader } from '../../../presentation/workbench'
export function GitPanelHeader({ branch, disabled, onRefresh, onClose }: { branch?: string; disabled: boolean; onRefresh: () => void; onClose: () => void }) {
  return <PanelHeader title="Git do projeto" description={branch || 'Alterações, histórico e publicação.'} icon="git" actions={<><IconButton label="Atualizar estado do Git" icon="refresh" disabled={disabled} onClick={onRefresh}/><IconButton label="Fechar Git" icon="close" onClick={onClose}/></>}/>
}
