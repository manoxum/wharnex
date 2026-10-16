import { IconButton, PanelHeader } from '../../../presentation/workbench'
export function DockerPanelHeader({ loading, onRefresh, onClose }: { loading: boolean; onRefresh: () => void; onClose?: () => void }) {
  return <PanelHeader title="Docker" description="Serviços e recursos no host local." icon="container" actions={<><IconButton label="Atualizar Docker" icon="refresh" disabled={loading} onClick={onRefresh}/>{onClose && <IconButton label="Fechar Docker" icon="close" onClick={onClose}/>}</>}/>
}
